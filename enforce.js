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
  var passWaitInterval = null;
  var hiddenFeeds = [];
  var scrollLocked = false;
  var submitting = false;
  var currentView = null; // which overlay is up — evaluate() skips identical
                          // re-renders so late load/storage events never wipe
                          // a half-typed intent

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
      if (!s || !s.site) continue;
      var entryBase = AR.baseDomain(s.site.replace(/^https?:\/\//, '').split('/')[0]);
      if (entryBase === base) return s;
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
    '.count{font-size:44px;font-weight:700;margin:8px 0;font-variant-numeric:tabular-nums;}',
    // escalation + receipts
    '.badge{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.02em;',
    'background:#7c2d12;color:#fed7aa;border:1px solid #9a3412;border-radius:999px;padding:5px 11px;margin:0 0 14px;}',
    '.badge.hot{background:#7f1d1d;color:#fecaca;border-color:#991b1b;}',
    '.receipts{margin:16px 0 0;padding-top:14px;border-top:1px solid #1e293b;font-size:13px;line-height:1.6;color:#94a3b8;}',
    '.receipts b{color:#e2e8f0;font-weight:600;}',
    '.pushback{background:#1c1207;border:1px solid #7c2d12;border-radius:10px;padding:13px 15px;margin:16px 0 0;',
    'font-size:14px;line-height:1.55;color:#fed7aa;}',
    '.wait{font-size:13px;color:#fbbf24;margin-top:12px;font-variant-numeric:tabular-nums;min-height:16px;}',
    '.confirm .btn{background:#f59e0b;color:#1c1207;}',
    '.ghost{background:transparent;color:#94a3b8;border:1px solid #334155;border-radius:10px;padding:12px 16px;',
    'font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;}',
    // spiral interrupt (distinct from the normal overlay)
    '.swrap{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;',
    'background:radial-gradient(120% 120% at 50% 0%,#3b0a0a,#1a0505 70%);color:#fee2e2;',
    "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;box-sizing:border-box;}",
    '.scard{max-width:560px;width:100%;text-align:left;}',
    '.seyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#fca5a5;margin:0 0 14px;}',
    '.shead{font-size:32px;line-height:1.1;font-weight:700;margin:0 0 10px;color:#fff5f5;}',
    '.ssub{font-size:15px;line-height:1.55;color:#fecaca;margin:0 0 22px;}',
    '.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:0 0 22px;}',
    '.tile{background:rgba(0,0,0,.35);border:1px solid #7f1d1d;border-radius:12px;padding:14px 16px;}',
    '.tile .n{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;color:#fff5f5;line-height:1;}',
    '.tile .l{font-size:12px;color:#fca5a5;margin-top:6px;line-height:1.3;}',
    '.tile.good{border-color:#166534;}',
    '.tile.good .n{color:#bbf7d0;}',
    '.tile.good .l{color:#86efac;}',
    '.ack{width:100%;box-sizing:border-box;background:#1a0505;color:#fee2e2;border:1px solid #7f1d1d;',
    'border-radius:10px;padding:13px;font-size:15px;font-family:inherit;outline:none;}',
    '.ack:focus{border-color:#f87171;}',
    '.abtn{background:#ef4444;color:#fff;border:none;border-radius:10px;padding:12px 20px;font-size:15px;',
    'font-weight:600;cursor:pointer;font-family:inherit;margin-top:14px;}',
    '.abtn:disabled{opacity:.45;cursor:default;}'
  ].join('');

  // ---- receipts formatting -------------------------------------------------
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function receiptsHtml(summary) {
    var visitOrd = ordinal(summary.passesToday + 1);
    var wk = summary.week;
    var lines = '<div>' + escapeHtml(visitOrd) + ' visit today &middot; <b>' +
      summary.minutesToday + ' min</b> on feeds today</div>';
    if (wk.passes > 0) {
      var drift = wk.topDriftHour === null ? '' :
        ' &middot; most drift around ' + fmtHour(wk.topDriftHour);
      lines += '<div>Last 7 days: <b>' + wk.passes + '</b> passes &middot; ' +
        wk.clean + ' clean / ' + wk.drifted + ' drifted' + drift + '</div>';
    }
    return '<div class="receipts">' + lines + '</div>';
  }

  function fmtHour(h) {
    var ampm = h < 12 ? 'am' : 'pm';
    var hr = h % 12; if (hr === 0) hr = 12;
    return hr + ampm;
  }

  function clearOverlay() {
    currentView = null;
    if (passWaitInterval) { clearInterval(passWaitInterval); passWaitInterval = null; }
    if (overlayShadow) overlayShadow.innerHTML = '';
    if (overlayHost && overlayHost.parentNode) overlayHost.parentNode.removeChild(overlayHost);
    overlayHost = null;
    overlayShadow = null;
    lockScroll(false);
  }

  function renderPassOverlay(cls, base, summary) {
    ensureHost();
    lockScroll(true);
    var platform = cls.platform === 'x' ? 'X' : (cls.platform === 'youtube' ? 'YouTube' : cls.base);
    var level = ARReceipts.escalationLevel(summary.passesLastHour);

    var badge = '';
    if (level === 2) {
      badge = '<span class="badge">2nd pass this hour</span>';
    } else if (level === 3) {
      badge = '<span class="badge hot">' + ordinal(summary.passesLastHour + 1) + ' pass this hour</span>';
    }

    var pushback = '';
    if (level === 3) {
      pushback = '<div class="pushback">You&rsquo;ve opened this feed <b>' + summary.passesLastHour +
        ' times</b> in the last hour &mdash; <b>' + summary.minutesLastHour + ' min</b> on feeds. ' +
        'That&rsquo;s ' + ordinal(summary.passesToday + 1) + ' time today. Sit with that for a minute before you ask again.</div>';
    }

    overlayShadow.innerHTML =
      '<style>' + OVERLAY_CSS + '</style>' +
      '<div class="wrap"><div class="card">' +
      '<p class="eyebrow">' + escapeHtml(platform) + ' &middot; feed blocked</p>' +
      badge +
      '<h1 class="headline">What are you here for?</h1>' +
      '<p class="sub">This surface is a slot machine. Say what you actually came to do and how long it needs — you’ll get a pass scoped to exactly that.</p>' +
      '<textarea class="ta" id="intent" placeholder="e.g. 10 min to find that thread about Rails testing"></textarea>' +
      pushback +
      '<div class="wait" id="wait"></div>' +
      '<div class="row" id="actions"></div>' +
      '<div class="err" id="err"></div>' +
      receiptsHtml(summary) +
      '</div></div>';

    var ta = overlayShadow.getElementById('intent');
    var err = overlayShadow.getElementById('err');
    var actions = overlayShadow.getElementById('actions');
    var wait = overlayShadow.getElementById('wait');

    function sendRequest(btn) {
      if (submitting) return;
      var intent = ta.value.trim();
      if (!intent) { err.textContent = 'Tell me what you’re here for first.'; return; }
      submitting = true;
      if (btn) { btn.disabled = true; btn.textContent = 'Thinking…'; }
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
          renderActions(); // reset the action row
          err.textContent = (resp && resp.error) || 'Something went wrong. Try again.';
          return;
        }
        evaluate();
      });
    }

    // Level 2: an explicit second confirm before the request is sent.
    function renderConfirm() {
      actions.className = 'row confirm';
      actions.innerHTML =
        '<button class="btn" id="confirm">Yes, grant it anyway</button>' +
        '<button class="ghost" id="back">Not now</button>';
      overlayShadow.getElementById('confirm').addEventListener('click', function () {
        sendRequest(overlayShadow.getElementById('confirm'));
      });
      overlayShadow.getElementById('back').addEventListener('click', function () {
        renderActions();
      });
    }

    function renderActions() {
      actions.className = 'row';
      if (level === 2) {
        actions.innerHTML = '<button class="btn" id="go">Get my pass</button>' +
          '<span class="hint">Second time this hour. You’ll confirm.</span>';
        overlayShadow.getElementById('go').addEventListener('click', function () {
          if (!ta.value.trim()) { err.textContent = 'Tell me what you’re here for first.'; return; }
          renderConfirm();
        });
      } else {
        actions.innerHTML = '<button class="btn" id="go">Get my pass</button>' +
          '<span class="hint">Be honest. The trail gets logged.</span>';
        overlayShadow.getElementById('go').addEventListener('click', function () {
          sendRequest(overlayShadow.getElementById('go'));
        });
      }
    }

    // Level 3: a mandatory 60s wait with input disabled before anything submits.
    function runWait() {
      var remaining = ARReceipts.WAIT_SECONDS;
      ta.disabled = true;
      actions.innerHTML = '<button class="btn" id="go" disabled>Wait ' + remaining + 's…</button>' +
        '<span class="hint">The feed will still be here.</span>';
      var go = overlayShadow.getElementById('go');
      wait.textContent = 'This is your ' + ordinal(summary.passesLastHour + 1) + ' pass this hour. Take a breath — ' + remaining + 's.';
      var tick = setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(tick);
          ta.disabled = false;
          wait.textContent = 'Okay. Still want it?';
          go.disabled = false;
          go.textContent = 'Get my pass';
          go.addEventListener('click', function () { sendRequest(go); });
          return;
        }
        go.textContent = 'Wait ' + remaining + 's…';
        wait.textContent = 'This is your ' + ordinal(summary.passesLastHour + 1) + ' pass this hour. Take a breath — ' + remaining + 's.';
      }, 1000);
      // Clean the interval if the overlay is torn down.
      passWaitInterval = tick;
    }

    if (level === 3) {
      runWait();
    } else {
      renderActions();
      ta.focus();
    }
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !ta.disabled) {
        var go = overlayShadow.getElementById('go');
        if (level === 2) { renderConfirm(); } else if (go && !go.disabled) { sendRequest(go); }
      }
    });
  }

  // ---- spiral interrupt overlay --------------------------------------------
  var SPIRAL_ACK = 'i see the pattern';
  function renderSpiralOverlay(sig) {
    if (passWaitInterval) { clearInterval(passWaitInterval); passWaitInterval = null; }
    ensureHost();
    lockScroll(true);
    hidePill();
    var s = sig.summary || {};
    var wk = s.week || { passes: 0, clean: 0, drifted: 0, topDriftHour: null };
    var streakTile = s.cleanStreak > 0
      ? '<div class="tile good"><div class="n">' + s.cleanStreak + '</div><div class="l">day clean streak — don’t break it</div></div>'
      : '<div class="tile"><div class="n">' + wk.drifted + '</div><div class="l">passes drifted this week</div></div>';

    overlayShadow.innerHTML =
      '<style>' + OVERLAY_CSS + '</style>' +
      '<div class="swrap"><div class="scard">' +
      '<p class="seyebrow">Spiral detected</p>' +
      '<h1 class="shead">Stop. Look at the last hour.</h1>' +
      '<p class="ssub">This isn’t a block — it’s a mirror. You’re not using these feeds, they’re using you.</p>' +
      '<div class="grid">' +
      '<div class="tile"><div class="n">' + (s.passesToday || 0) + '</div><div class="l">visits today</div></div>' +
      '<div class="tile"><div class="n">' + (s.minutesToday || 0) + '</div><div class="l">min on feeds today</div></div>' +
      '<div class="tile"><div class="n">' + (s.passesLastHour || 0) + '</div><div class="l">passes this hour</div></div>' +
      streakTile +
      '</div>' +
      '<p class="ssub">Type <b>“' + SPIRAL_ACK + '”</b> to close this.</p>' +
      '<input class="ack" id="ack" placeholder="' + SPIRAL_ACK + '" autocomplete="off" spellcheck="false">' +
      '<div><button class="abtn" id="adone" disabled>Close</button></div>' +
      '</div></div>';

    var ack = overlayShadow.getElementById('ack');
    var done = overlayShadow.getElementById('adone');
    ack.focus();
    function check() {
      done.disabled = ack.value.trim().toLowerCase() !== SPIRAL_ACK;
    }
    ack.addEventListener('input', check);
    function dismiss() {
      if (done.disabled) return;
      chrome.storage.local.set({ spiralAck: sig.id }, function () { evaluate(); });
    }
    done.addEventListener('click', dismiss);
    ack.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { check(); dismiss(); }
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
    Promise.all([
      syncGet(['blockedSites']),
      localGet(['activePasses', 'trailLog', 'spiralSignal', 'spiralAck'])
    ]).then(function (vals) {
      evaluating = false;
      var blockedSites = vals[0].blockedSites || [];
      var local = vals[1];
      var cls = AR.classify(location.href);
      if (!cls) { fullClear(); return; }
      var site = matchBlockedSite(cls.base, blockedSites);
      if (!site) { fullClear(); return; }

      var summary = ARReceipts.summarize(local.trailLog || { passes: [] });

      // Spiral interrupt preempts everything — but never over unsaved work.
      var sig = local.spiralSignal;
      if (sig && local.spiralAck !== sig.id) {
        if (hasActiveDraft()) { scheduleDraftRecheck(); return; }
        if (currentView === 'spiral:' + sig.id) return;
        stopHeartbeat(); renderSpiralOverlay(sig); currentView = 'spiral:' + sig.id; return;
      }

      var hard = !!site.hardBlock && (!site.hardBlockExpiry || Date.now() < site.hardBlockExpiry);

      if (!cls.blocked && !hard) { fullClear(); return; }

      if (hard) {
        stopHeartbeat();
        hidePill();
        // hard block ignores drafts on blocked feeds? No: never destroy work.
        if (hasActiveDraft()) { clearOverlay(); restoreFeed(); showBanner(); scheduleDraftRecheck(); return; }
        hideBanner();
        if (currentView !== 'hard:' + cls.base) {
          renderHardOverlay(cls, site);
          currentView = 'hard:' + cls.base;
        }
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
      var viewKey = 'pass:' + cls.surfaceId + ':' + ARReceipts.escalationLevel(summary.passesLastHour);
      if (currentView !== viewKey) {
        renderPassOverlay(cls, cls.base, summary);
        currentView = viewKey;
      }
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
    if ((area === 'local' && (changes.activePasses || changes.spiralSignal || changes.spiralAck)) ||
        (area === 'sync' && changes.blockedSites)) {
      evaluate();
    }
  });

  document.addEventListener('DOMContentLoaded', evaluate);
  window.addEventListener('load', evaluate);
  evaluate();
})();
