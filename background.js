// Service worker: pass office (Anthropic call + fallback), pass lifecycle,
// trail logging, per-hour analytics, and dynamic content-script registration
// for user-added domains. Enforcement itself lives in the content script; this
// worker never reloads or navigates a tab.

importScripts('surface-rules.js', 'receipts.js');

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
var TRAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
var SPIRAL_COOLDOWN_MS = 60 * 60 * 1000; // fire at most once per hour

// ---- small storage helpers -------------------------------------------------
function localGet(keys) { return new Promise(function (r) { chrome.storage.local.get(keys, r); }); }
function localSet(obj) { return new Promise(function (r) { chrome.storage.local.set(obj, r); }); }
function syncGet(keys) { return new Promise(function (r) { chrome.storage.sync.get(keys, r); }); }
function syncSet(obj) { return new Promise(function (r) { chrome.storage.sync.set(obj, r); }); }

function today() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---- analytics (preserve v1 spirit: date/hour pass counts) -----------------
function recordGrant(minutes) {
  return localGet(['passData']).then(function (r) {
    var passData = r.passData || {};
    var day = today();
    var hour = new Date().getHours();
    if (!passData[day]) passData[day] = {};
    if (!passData[day][hour]) passData[day][hour] = { count: 0, minutes: 0 };
    passData[day][hour].count += 1;
    passData[day][hour].minutes += minutes;
    return localSet({ passData: passData });
  });
}

// ---- trail log -------------------------------------------------------------
function pruneTrail(passes) {
  var cutoff = Date.now() - TRAIL_RETENTION_MS;
  return passes.filter(function (p) { return (p.endTs || p.startTs || 0) >= cutoff; });
}

function openTrail(pass) {
  return localGet(['trailLog']).then(function (r) {
    var log = r.trailLog || { passes: [] };
    log.passes = pruneTrail(log.passes || []);
    log.passes.push({
      passId: pass.passId,
      domain: pass.domain,
      platform: pass.platform,
      intent: pass.intent,
      label: pass.label,
      scopeSurfaces: pass.scopeSurfaces,
      startTs: pass.startTs,
      endTs: pass.endTs,
      events: [{ url: pass.startUrl, ts: pass.startTs, dwellMs: 0, inScope: true }]
    });
    return localSet({ trailLog: log });
  });
}

function recordHeartbeat(passId, url, inScope) {
  return localGet(['trailLog']).then(function (r) {
    var log = r.trailLog || { passes: [] };
    var p = (log.passes || []).find(function (x) { return x.passId === passId; });
    if (!p) return;
    var ev = p.events[p.events.length - 1];
    if (ev && ev.url === url) {
      ev.dwellMs += 15000;
      ev.inScope = inScope;
    } else {
      p.events.push({ url: url, ts: Date.now(), dwellMs: 0, inScope: inScope });
    }
    return localSet({ trailLog: log }).then(maybeTriggerSpiral);
  });
}

// ---- spiral interrupt ------------------------------------------------------
// Binge = 3+ passes granted this hour OR >20 min on feeds this hour. When it
// trips (and we haven't tripped in the last hour), stash a signal the content
// script picks up and renders the full-screen receipts moment. The content
// script still gates on the draft guard — it never shows over unsaved work.
function maybeTriggerSpiral() {
  return localGet(['trailLog', 'lastSpiralTs']).then(function (r) {
    var now = Date.now();
    if (r.lastSpiralTs && now - r.lastSpiralTs < SPIRAL_COOLDOWN_MS) return;
    var summary = ARReceipts.summarize(r.trailLog || { passes: [] }, now);
    if (!ARReceipts.isBinge(summary)) return;
    return localSet({
      lastSpiralTs: now,
      spiralSignal: { id: 's_' + now, ts: now, summary: summary }
    });
  });
}

// ---- the pass office -------------------------------------------------------
function parseDurationFallback(text) {
  var m = String(text).match(/(\d+)\s*(?:min|minute|minutes|m)\b/i);
  var n = m ? parseInt(m[1], 10) : 5;
  if (isNaN(n) || n < 1) n = 5;
  return Math.min(30, n);
}

function buildPrompt(intent, platform, pathname) {
  var vocab = AR.PLATFORM_VOCAB[platform] || AR.PLATFORM_VOCAB.generic;
  return [
    'You are the pass office for a focus extension. The user wants temporary access to a normally-blocked surface.',
    'Platform: ' + platform,
    'Blocked surfaces (need a pass): ' + vocab.blocked.join('; '),
    'Normally-allowed (no pass needed): ' + (vocab.allowed.length ? vocab.allowed.join('; ') : '(none)'),
    'They are currently on path: ' + pathname,
    'Their stated intent: "' + intent + '"',
    '',
    'Grant a scoped pass. Respond with ONLY strict minified JSON, no prose, no code fences:',
    '{"durationMinutes":<int 1-30>,"scopeSurfaces":["<path-pattern>",...],"label":"<<=8 word restatement>"}',
    '',
    'Rules:',
    '- durationMinutes: infer from intent; a quick lookup 2-3, some research 8-12, a break 15-25; default 8; clamp 1-30.',
    '- scopeSurfaces: path-pattern strings (e.g. "/home","/search*","/explore") the intent legitimately needs. Always include the current path. Keep it tight.',
    '- label: short restatement of what they are here for.'
  ].join('\n');
}

function extractJson(text) {
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

function callAnthropic(apiKey, intent, platform, pathname) {
  return fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: buildPrompt(intent, platform, pathname) }]
    })
  }).then(function (resp) {
    if (!resp.ok) return resp.text().then(function (t) { throw new Error('API ' + resp.status + ': ' + t.slice(0, 120)); });
    return resp.json();
  }).then(function (data) {
    var text = (data.content && data.content[0] && data.content[0].text) || '';
    var parsed = extractJson(text);
    if (!parsed) throw new Error('unparseable model output');
    return parsed;
  });
}

function normalizeScope(scope, canonicalPattern) {
  var out = Array.isArray(scope) ? scope.filter(function (s) { return typeof s === 'string' && s; }) : [];
  if (out.indexOf(canonicalPattern) === -1) out.unshift(canonicalPattern);
  return out;
}

function grantPass(req) {
  var durationP = syncGet(['apiKey']).then(function (r) {
    var apiKey = r.apiKey;
    if (!apiKey) {
      return { durationMinutes: parseDurationFallback(req.intent), scopeSurfaces: [req.canonicalPattern], label: req.intent.slice(0, 60), fallback: true };
    }
    return callAnthropic(apiKey, req.intent, req.platform, req.pathname).then(function (parsed) {
      var dur = parseInt(parsed.durationMinutes, 10);
      if (isNaN(dur) || dur < 1) dur = 5;
      dur = Math.min(30, dur);
      return {
        durationMinutes: dur,
        scopeSurfaces: normalizeScope(parsed.scopeSurfaces, req.canonicalPattern),
        label: (typeof parsed.label === 'string' && parsed.label) ? parsed.label : req.intent.slice(0, 60),
        fallback: false
      };
    }).catch(function () {
      // Graceful fallback: the flow must feel identical.
      return { durationMinutes: parseDurationFallback(req.intent), scopeSurfaces: [req.canonicalPattern], label: req.intent.slice(0, 60), fallback: true };
    });
  });

  return durationP.then(function (result) {
    var now = Date.now();
    var pass = {
      passId: 'p_' + now + '_' + Math.random().toString(36).slice(2, 8),
      domain: req.domain,
      platform: req.platform,
      intent: req.intent,
      label: result.label,
      scopeSurfaces: result.scopeSurfaces,
      startTs: now,
      endTs: now + result.durationMinutes * 60000,
      startUrl: req.pathname
    };
    return localGet(['activePasses']).then(function (r) {
      var passes = r.activePasses || {};
      passes[req.domain] = pass;
      return localSet({ activePasses: passes });
    }).then(function () {
      chrome.alarms.create('expirePass_' + req.domain, { when: pass.endTs });
      return Promise.all([openTrail(pass), recordGrant(result.durationMinutes)]);
    }).then(maybeTriggerSpiral).then(function () {
      return { granted: true, pass: pass, fallback: result.fallback };
    });
  });
}

function expirePass(domain) {
  return localGet(['activePasses']).then(function (r) {
    var passes = r.activePasses || {};
    if (passes[domain]) {
      delete passes[domain];
      return localSet({ activePasses: passes });
    }
  });
}

// ---- messaging -------------------------------------------------------------
chrome.runtime.onMessage.addListener(function (req, sender, sendResponse) {
  if (req.action === 'requestPass') {
    grantPass(req).then(function (res) { sendResponse(res); }, function (err) {
      sendResponse({ granted: false, error: (err && err.message) || 'grant failed' });
    });
    return true;
  }
  if (req.action === 'heartbeat') {
    recordHeartbeat(req.passId, req.url, req.inScope);
    return false;
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name.indexOf('expirePass_') === 0) {
    expirePass(alarm.name.slice('expirePass_'.length));
  }
});

// ---- dynamic content-script registration for user-added domains ------------
function domainsFromBlockedSites(blockedSites) {
  var set = {};
  (blockedSites || []).forEach(function (s) {
    var name = typeof s === 'string' ? s : s.site;
    if (!name) return;
    set[AR.baseDomain(name.replace(/^https?:\/\//, '').split('/')[0])] = true;
  });
  return Object.keys(set);
}

function syncDynamicScripts() {
  return syncGet(['blockedSites']).then(function (r) {
    var domains = domainsFromBlockedSites(r.blockedSites).filter(function (d) {
      return AR.STATIC_HOSTS.indexOf(d) === -1;
    });
    return chrome.scripting.getRegisteredContentScripts().then(function (existing) {
      var arScripts = existing.filter(function (s) { return s.id.indexOf('ar-') === 0; });
      var existingIds = arScripts.map(function (s) { return s.id; });
      var desired = domains.map(function (d) {
        return {
          id: 'ar-' + d,
          matches: ['*://*.' + d + '/*', '*://' + d + '/*'],
          js: ['surface-rules.js', 'receipts.js', 'enforce.js'],
          runAt: 'document_start'
        };
      });
      var desiredIds = desired.map(function (d) { return d.id; });

      var toUnregister = existingIds.filter(function (id) { return desiredIds.indexOf(id) === -1; });
      var toRegister = desired.filter(function (d) { return existingIds.indexOf(d.id) === -1; });

      var p = Promise.resolve();
      if (toUnregister.length) p = p.then(function () { return chrome.scripting.unregisterContentScripts({ ids: toUnregister }); });
      if (toRegister.length) {
        p = p.then(function () {
          // Only register domains we actually have host permission for.
          return Promise.all(toRegister.map(function (script) {
            return chrome.permissions.contains({ origins: script.matches }).then(function (has) {
              return has ? script : null;
            });
          })).then(function (ok) {
            var grantable = ok.filter(Boolean);
            if (grantable.length) return chrome.scripting.registerContentScripts(grantable);
          });
        });
      }
      return p.catch(function (e) { console.warn('syncDynamicScripts:', e && e.message); });
    });
  });
}

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'sync' && changes.blockedSites) syncDynamicScripts();
});

// ---- migration + seed ------------------------------------------------------
function migrateBlockedSites() {
  return syncGet(['blockedSites']).then(function (data) {
    var sites = data.blockedSites;
    if (!Array.isArray(sites)) {
      // Fresh install: seed the two managed platforms so it works out of the box.
      return syncSet({ blockedSites: [
        { site: 'x.com', hardBlock: false, hardBlockExpiry: null },
        { site: 'youtube.com', hardBlock: false, hardBlockExpiry: null }
      ] });
    }
    var needs = sites.some(function (s) {
      return typeof s === 'string' || (typeof s === 'object' && s.hardBlockExpiry === undefined);
    });
    if (!needs) return;
    var migrated = sites.map(function (s) {
      if (typeof s === 'string') return { site: s, hardBlock: false, hardBlockExpiry: null };
      if (s.hardBlockExpiry === undefined) {
        return { site: s.site, hardBlock: s.hardBlock || false, hardBlockExpiry: s.hardBlock ? (Date.now() + 7 * 86400000) : null };
      }
      return s;
    });
    return syncSet({ blockedSites: migrated });
  });
}

function cleanupExpiredHardBlocks() {
  return syncGet(['blockedSites']).then(function (data) {
    if (!Array.isArray(data.blockedSites)) return;
    var now = Date.now();
    var changed = false;
    var updated = data.blockedSites.map(function (s) {
      if (typeof s === 'object' && s.hardBlock && s.hardBlockExpiry && now > s.hardBlockExpiry) {
        changed = true;
        return { site: s.site, hardBlock: false, hardBlockExpiry: null };
      }
      return s;
    });
    if (changed) return syncSet({ blockedSites: updated });
  });
}

function init() {
  migrateBlockedSites()
    .then(cleanupExpiredHardBlocks)
    .then(syncDynamicScripts);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

chrome.alarms.create('cleanupHardBlocks', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === 'cleanupHardBlocks') cleanupExpiredHardBlocks();
});
