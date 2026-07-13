// Non-destructive, surface-level enforcement. Runs at document_start on
// x.com/twitter.com/youtube.com (static) and on user-added domains (dynamic).
//
// Contract: NEVER reload or navigate the tab. Block by hiding the feed element
// and showing a full-viewport shadow-DOM overlay. Defer entirely while the user
// has an unsaved draft. Re-evaluate on every SPA route change.

(function () {
  if (window.__attentionRehabActive) return;
  window.__attentionRehabActive = true;

  var HOST_ID = 'attention-rehab-overlay-host';
  var overlayHost = null;
  var overlayShadow = null;
  var pillEl = null;
  var pillInterval = null;
  var bannerEl = null;
  var heartbeatTimer = null;
  var passExpiryTimer = null;
  var draftRecheckTimer = null;
  var hiddenFeeds = [];
  var scrollLocked = false;
  var submitting = false;

  // ---- storage helpers -----------------------------------------------------
  function syncGet(keys) {
    return new Promise(function (res) { chrome.storage.sync.get(keys, res); });
  }
  function localGet(keys) {
    return new Promise(function (res) { chrome.storage.local.get(keys, res); });
  }

  function matchBlockedSite(base, blockedSites) {
    if (!Array.isArray(blockedSites)) return null;
    for (var i = 0; i < blockedSites.length; i++) {
      var s = blockedSites[i];
      var name = typeof s === 'string' ? s : s.site;
      if (!name) continue;
      var entryBase = AR.baseDomain(name.replace(/^https?:\/\//, '').split('/')[0]);
      if (entryBase === base) {
        return typeof s === 'string' ? { site: s, hardBlock: false, hardBlockExpiry: null } : s;
      }
    }
    return null;
  }

  function getActivePass(base) {
    return localGet(['activePasses']).then(function (r) {
      var passes = r.activePasses || {};
      return passes[base] || null;
    });
  }

  // ---- draft guard ---------------------------------------------------------
  function hasActiveDraft() {
    var nodes = document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getRootNode() !== document) continue; // skip our own shadow input
      if (el.offsetParent === null && el.getClientRects().length === 0) continue; // hidden
      var text = ('value' in el && el.tagName === 'TEXTAREA') ? el.value : el.textContent;
      if (text && text.trim().length > 0) return true;
    }
    return false;
  }

  // ---- feed hiding (defense in depth; overlay is the real block) -----------
  function hideFeed(selectors) {
    (selectors || []).forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (el.dataset.arHidden) return;
        el.dataset.arHidden = '1';
        el.dataset.arPrevVis = el.style.visibility || '';
        el.style.visibility = 'hidden';
        hiddenFeeds.push(el);
      });
    });
  }
  function restoreFeed() {
    hiddenFeeds.forEach(function (el) {
      if (el && el.dataset) {
        el.style.visibility = el.dataset.arPrevVis || '';
        delete el.dataset.arHidden;
        delete el.dataset.arPrevVis;
      }
    });
    hiddenFeeds = [];
  }

  function lockScroll(on) {
    var de = document.documentElement;
    if (on && !scrollLocked) {
      de.dataset.arPrevOverflow = de.style.overflow || '';
      de.style.overflow = 'hidden';
      scrollLocked = true;
    } else if (!on && scrollLocked) {
      de.style.overflow = de.dataset.arPrevOverflow || '';
      delete de.dataset.arPrevOverflow;
      scrollLocked = false;
    }
  }

  // ---- overlay -------------------------------------------------------------
  function ensureHost() {
    if (overlayHost && document.documentElement.contains(overlayHost)) return;
    overlayHost = document.getElementById(HOST_ID);
    if (!overlayHost) {
      overlayHost = document.createElement('div');
      overlayHost.id = HOST_ID;
      overlayHost.style.cssText = 'all:initial;';
      document.documentElement.appendChild(overlayHost);
      overlayShadow = overlayHost.attachShadow({ mode: 'open' });
    } else if (!overlayShadow) {
      overlayShadow = overlayHost.shadowRoot || overlayHost.attachShadow({ mode: 'open' });
    }
  }

  var OVERLAY_CSS = [
    ':host{all:initial;}',
    '.wrap{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;',
    'background:linear-gradient(160deg,#0f172a,#1e293b);color:#f1f5f9;',
    "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;box-sizing:border-box;}",
    '.card{max-width:520px;width:100%;text-align:left;}',
    '.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc;margin:0 0 14px;}',
    '.headline{font-size:30px;line-height:1.15;font-weight:600;margin:0 0 12px;}',
    '.sub{font-size:15px;line-height:1.55;color:#cbd5e1;margin:0 0 22px;}',
    '.ta{width:100%;box-sizing:border-box;min-height:88px;resize:vertical;background:#0b1220;color:#f1f5f9;',
    'border:1px solid #334155;border-radius:10px;padding:14px;font-size:15px;font-family:inherit;outline:none;}',
    '.ta:focus{border-color:#38bdf8;}',
    '.row{display:flex;gap:10px;align-items:center;margin-top:16px;}',
    '.btn{background:#38bdf8;color:#03263a;border:none;border-radius:10px;padding:12px 20px;font-size:15px;',
    'font-weight:600;cursor:pointer;font-family:inherit;}',
    '.btn:disabled{opacity:.6;cursor:default;}',
    '.hint{font-size:13px;color:#94a3b8;}',
    '.err{color:#fca5a5;font-size:13px;margin-top:10px;min-height:16px;}',
    '.count{font-size:44px;font-weight:700;margin:8px 0;font-variant-numeric:tabular-nums;}'
  ].join('');

  function clearOverlay() {
    if (overlayShadow) overlayShadow.innerHTML = '';
    if (overlayHost && overlayHost.parentNode) overlayHost.parentNode.removeChild(overlayHost);
    overlayHost = null;
    overlayShadow = null;
    lockScroll(false);
  }

  function renderPassOverlay(cls, base) {
    ensureHost();
    lockScroll(true);
    var platform = cls.platform === 'x' ? 'X' : (cls.platform === 'youtube' ? 'YouTube' : cls.base);
    overlayShadow.innerHTML =
      '<style>' + OVERLAY_CSS + '</style>' +
      '<div class="wrap"><div class="card">' +
      '<p class="eyebrow">' + escapeHtml(platform) + ' &middot; feed blocked</p>' +
      '<h1 class="headline">What are you here for?</h1>' +
      '<p class="sub">This surface is a slot machine. Say what you actually came to do and how long it needs — you’ll get a pass scoped to exactly that.</p>' +
      '<textarea class="ta" id="intent" placeholder="e.g. 10 min to find that thread about Rails testing"></textarea>' +
      '<div class="row"><button class="btn" id="go">Get my pass</button>' +
      '<span class="hint">Be honest. The trail gets logged.</span></div>' +
      '<div class="err" id="err"></div>' +
      '</div></div>';
    var ta = overlayShadow.getElementById('intent');
    var go = overlayShadow.getElementById('go');
    var err = overlayShadow.getElementById('err');
    ta.focus();
    function submit() {
      if (submitting) return;
      var intent = ta.value.trim();
      if (!intent) { err.textContent = 'Tell me what you’re here for first.'; return; }
      submitting = true;
      go.disabled = true;
      go.textContent = 'Thinking…';
      err.textContent = '';
      chrome.runtime.sendMessage({
        action: 'requestPass',
        intent: intent,
        domain: base,
        platform: cls.platform,
        pathname: cls.pathname,
        canonicalPattern: cls.canonicalPattern
      }, function (resp) {
        submitting = false;
        if (!resp || !resp.granted) {
          go.disabled = false;
          go.textContent = 'Get my pass';
          err.textContent = (resp && resp.error) || 'Something went wrong. Try again.';
          return;
        }
        evaluate();
      });
    }
    go.addEventListener('click', submit);
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
    });
  }

  function renderHardOverlay(cls, site) {
    ensureHost();
    lockScroll(true);
    var expiry = site.hardBlockExpiry;
    var body;
    if (expiry && Date.now() < expiry) {
      body = '<div class="count" id="hardcount"></div>' +
        '<p class="sub">No passes. You chose this. The only exit is waiting it out.</p>';
    } else {
      body = '<p class="sub">This site is hard-blocked. No passes available.</p>';
    }
    overlayShadow.innerHTML =
      '<style>' + OVERLAY_CSS + '</style>' +
      '<div class="wrap"><div class="card">' +
      '<p class="eyebrow">Hard block</p>' +
      '<h1 class="headline">Locked, on purpose.</h1>' + body +
      '</div></div>';
    var el = overlayShadow.getElementById('hardcount');
    if (el) {
      var tick = function () {
        var ms = expiry - Date.now();
        if (ms <= 0) { evaluate(); return; }
        var d = Math.floor(ms / 86400000);
        var h = Math.floor((ms % 86400000) / 3600000);
        var m = Math.floor((ms % 3600000) / 60000);
        el.textContent = d + 'd ' + h + 'h ' + m + 'm';
      };
      tick();
      if (pillInterval) clearInterval(pillInterval);
      pillInterval = setInterval(tick, 30000);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- countdown pill (active pass) ----------------------------------------
  function showPill(pass) {
    if (!pillEl || !document.documentElement.contains(pillEl)) {
      pillEl = document.createElement('div');
      pillEl.id = 'attention-rehab-pill';
      pillEl.style.cssText = 'all:initial;position:fixed;bottom:18px;right:18px;z-index:2147483646;' +
        'background:#0f172a;color:#7dd3fc;font:600 13px/1 Inter,-apple-system,sans-serif;' +
        'padding:9px 13px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.35);' +
        'border:1px solid #334155;font-variant-numeric:tabular-nums;pointer-events:none;';
      document.documentElement.appendChild(pillEl);
    }
    var update = function () {
      var ms = pass.endTs - Date.now();
      if (ms <= 0) { hidePill(); evaluate(); return; }
      var m = Math.floor(ms / 60000);
      var s = Math.floor((ms % 60000) / 1000);
      pillEl.textContent = 'pass: ' + m + ':' + String(s).padStart(2, '0');
    };
    update();
    if (pillInterval) clearInterval(pillInterval);
    pillInterval = setInterval(update, 1000);
  }
  function hidePill() {
    if (pillInterval) { clearInterval(pillInterval); pillInterval = null; }
    if (pillEl && pillEl.parentNode) pillEl.parentNode.removeChild(pillEl);
    pillEl = null;
  }

  // ---- corner banner (draft deferral) --------------------------------------
  function showBanner() {
    if (bannerEl && document.documentElement.contains(bannerEl)) return;
    bannerEl = document.createElement('div');
    bannerEl.id = 'attention-rehab-banner';
    bannerEl.style.cssText = 'all:initial;position:fixed;bottom:18px;left:18px;z-index:2147483646;max-width:280px;' +
      'background:#1e293b;color:#e2e8f0;font:500 13px/1.4 Inter,-apple-system,sans-serif;' +
      'padding:11px 14px;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.35);border:1px solid #334155;';
    bannerEl.textContent = 'pass expired — overlay returns when your draft is done';
    document.documentElement.appendChild(bannerEl);
  }
  function hideBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }

  // ---- heartbeat (trail logging) -------------------------------------------
  function startHeartbeat(pass, inScope) {
    stopHeartbeat();
    var beat = function () {
      chrome.runtime.sendMessage({
        action: 'heartbeat',
        passId: pass.passId,
        domain: pass.domain,
        url: location.href,
        inScope: AR.matchScope(pass.scopeSurfaces, location.href)
      });
    };
    beat();
    heartbeatTimer = setInterval(beat, 15000);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  // ---- main evaluation -----------------------------------------------------
  function fullClear() {
    stopHeartbeat();
    hidePill();
    hideBanner();
    clearOverlay();
    restoreFeed();
    if (passExpiryTimer) { clearTimeout(passExpiryTimer); passExpiryTimer = null; }
    if (draftRecheckTimer) { clearTimeout(draftRecheckTimer); draftRecheckTimer = null; }
  }

  var evaluating = false;
  function evaluate() {
    if (evaluating) return;
    evaluating = true;
    Promise.all([syncGet(['blockedSites']), localGet(['activePasses'])]).then(function (vals) {
      evaluating = false;
      var blockedSites = vals[0].blockedSites || [];
      var cls = AR.classify(location.href);
      if (!cls) { fullClear(); return; }
      var site = matchBlockedSite(cls.base, blockedSites);
      if (!site) { fullClear(); return; }

      var hard = !!site.hardBlock && (!site.hardBlockExpiry || Date.now() < site.hardBlockExpiry);

      if (!cls.blocked && !hard) { fullClear(); return; }

      if (hard) {
        stopHeartbeat();
        hidePill();
        // hard block ignores drafts on blocked feeds? No: never destroy work.
        if (hasActiveDraft()) { clearOverlay(); restoreFeed(); showBanner(); scheduleDraftRecheck(); return; }
        hideBanner();
        renderHardOverlay(cls, site);
        return;
      }

      // Active, in-scope pass?
      var passes = vals[1].activePasses || {};
      var pass = passes[cls.base];
      if (pass && Date.now() < pass.endTs && AR.matchScope(pass.scopeSurfaces, location.href)) {
        clearOverlay();
        restoreFeed();
        hideBanner();
        showPill(pass);
        startHeartbeat(pass);
        schedulePassExpiry(pass.endTs);
        return;
      }

      // Must enforce. Draft guard defers everything.
      stopHeartbeat();
      hidePill();
      if (hasActiveDraft()) {
        clearOverlay();
        restoreFeed();
        showBanner();
        scheduleDraftRecheck();
        return;
      }
      hideBanner();
      hideFeed(cls.feedSelectors);
      renderPassOverlay(cls, cls.base);
    }, function () { evaluating = false; });
  }

  function schedulePassExpiry(endTs) {
    if (passExpiryTimer) clearTimeout(passExpiryTimer);
    var ms = endTs - Date.now();
    if (ms <= 0) { evaluate(); return; }
    passExpiryTimer = setTimeout(evaluate, ms + 250);
  }

  function scheduleDraftRecheck() {
    if (draftRecheckTimer) clearTimeout(draftRecheckTimer);
    draftRecheckTimer = setTimeout(function () {
      draftRecheckTimer = null;
      evaluate();
    }, 2000);
  }

  // ---- SPA navigation detection --------------------------------------------
  function onNavChange() { evaluate(); }

  (function patchHistory() {
    var push = history.pushState;
    var replace = history.replaceState;
    history.pushState = function () { var r = push.apply(this, arguments); window.dispatchEvent(new Event('ar:locationchange')); return r; };
    history.replaceState = function () { var r = replace.apply(this, arguments); window.dispatchEvent(new Event('ar:locationchange')); return r; };
  })();
  window.addEventListener('ar:locationchange', onNavChange);
  window.addEventListener('popstate', onNavChange);
  window.addEventListener('hashchange', onNavChange);
  window.addEventListener('yt-navigate-finish', onNavChange);

  // Fallback poll for SPAs that swap URL without history events we caught.
  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      evaluate();
    }
  }, 1000);

  // React to pass grants / block-list edits from other contexts.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if ((area === 'local' && changes.activePasses) || (area === 'sync' && changes.blockedSites)) {
      evaluate();
    }
  });

  document.addEventListener('DOMContentLoaded', evaluate);
  window.addEventListener('load', evaluate);
  evaluate();
})();
