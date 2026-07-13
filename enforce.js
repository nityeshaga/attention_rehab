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

  // Visual language: "the ledger". The checkpoint is a paper intention slip —
  // ink on warm paper, serif voice, mono receipts — not a punishment screen.
  // Escalation stamps the slip and stripes the header; the spiral inverts
  // everything to ink-black + signal red. No external assets: system serif
  // (Charter/Georgia) + system mono (SF Mono/Menlo), gradients and hairlines.
  var MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
  var SERIF = "Charter,'Iowan Old Style',Georgia,'Times New Roman',serif";
  var OVERLAY_CSS = [
    ':host{all:initial;}',
    '*,*::before,*::after{box-sizing:border-box;}',
    '@keyframes ar-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}',
    '@keyframes ar-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(255,69,58,.55)}50%{opacity:.5;box-shadow:0 0 0 8px rgba(255,69,58,0)}}',
    // ---- checkpoint shell (pass panel + hard block) ----
    '.wrap{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;',
    'background:radial-gradient(120% 90% at 50% 0%,#282119 0%,#161210 55%,#0c0a08 100%);',
    'font-family:' + SERIF + ';color:#211d17;padding:24px;}',
    '.card{position:relative;max-width:580px;width:100%;text-align:left;',
    'background:linear-gradient(176deg,#f8f3e7 0%,#f1e8d5 100%);padding:36px 42px 30px;border-radius:2px;',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 44px 90px rgba(0,0,0,.62),0 4px 18px rgba(0,0,0,.45);',
    'animation:ar-rise .38s cubic-bezier(.22,1,.36,1) both;}',
    '.card::before{content:"";position:absolute;top:0;left:0;right:0;height:5px;background:#211d17;}',
    '.lv2 .card::before{height:7px;background:repeating-linear-gradient(-45deg,#b45309 0 12px,#211d17 12px 24px);}',
    '.lv3 .card::before{height:9px;background:repeating-linear-gradient(-45deg,#b3261e 0 12px,#211d17 12px 24px);}',
    '.eyebrow{display:flex;align-items:center;gap:12px;margin:0 0 20px;',
    'font:700 11px/1 ' + MONO + ';letter-spacing:.14em;text-transform:uppercase;color:#8a8070;}',
    '.eyebrow .rule{flex:1;height:1px;background:#d3c6a9;}',
    '.headline{font-size:38px;line-height:1.08;font-weight:700;letter-spacing:-.01em;margin:0 0 12px;color:#191510;}',
    '.sub{font-size:16px;line-height:1.55;color:#57503f;margin:0 0 20px;}',
    '.ta{width:100%;min-height:96px;resize:vertical;background:rgba(255,255,255,.55);color:#211d17;',
    'border:1px solid #c9bda1;border-radius:2px;padding:14px 16px;font:400 17px/1.5 ' + SERIF + ';',
    'caret-color:#b3261e;outline:none;}',
    '.ta::placeholder{color:#9a8f78;font-style:italic;}',
    '.ta:focus{border-color:#211d17;box-shadow:0 0 0 3px rgba(33,29,23,.08);}',
    '.ta:disabled{opacity:.5;}',
    '.row{display:flex;gap:12px;align-items:center;margin-top:18px;flex-wrap:wrap;}',
    '.btn{background:#211d17;color:#f5efe2;border:none;border-radius:2px;padding:15px 22px;cursor:pointer;',
    'font:700 12.5px/1 ' + MONO + ';letter-spacing:.08em;text-transform:uppercase;',
    'box-shadow:3px 3px 0 rgba(33,29,23,.22);transition:transform .12s,box-shadow .12s;}',
    '.btn:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:4px 4px 0 rgba(33,29,23,.28);}',
    '.btn:active:not(:disabled){transform:translate(1px,1px);box-shadow:1px 1px 0 rgba(33,29,23,.25);}',
    '.btn:disabled{opacity:.5;cursor:default;box-shadow:none;}',
    '.confirm .btn{background:#92400e;box-shadow:3px 3px 0 rgba(146,64,14,.25);}',
    '.ghost{background:transparent;color:#6b6355;border:1px solid #ab9e80;border-radius:2px;padding:15px 18px;',
    'font:700 12.5px/1 ' + MONO + ';letter-spacing:.08em;text-transform:uppercase;cursor:pointer;}',
    '.ghost:hover{border-color:#211d17;color:#211d17;}',
    '.hint{font:600 11px/1.5 ' + MONO + ';letter-spacing:.06em;text-transform:uppercase;color:#8a8070;}',
    '.err{font:600 12px/1.5 ' + MONO + ';color:#b3261e;margin-top:10px;}',
    '.wait{font:600 12.5px/1.5 ' + MONO + ';color:#92400e;margin-top:12px;font-variant-numeric:tabular-nums;}',
    '.err:empty,.wait:empty{display:none;}',
    '.lv3 .wait{color:#b3261e;}',
    '.badge{display:inline-block;margin:0 0 16px;padding:6px 10px;border-radius:2px;transform:rotate(-1.5deg);',
    'font:700 11px/1 ' + MONO + ';letter-spacing:.1em;text-transform:uppercase;',
    'color:#92400e;border:2px solid #b45309;background:rgba(180,83,9,.07);}',
    '.badge.hot{color:#b3261e;border-color:#b3261e;background:rgba(179,38,30,.07);transform:rotate(-2deg);}',
    '.pushback{margin:16px 0 0;padding:13px 16px;border-left:3px solid #b3261e;background:rgba(179,38,30,.06);',
    'font-size:15px;line-height:1.55;color:#7c221c;}',
    '.pushback b{color:#5d1712;}',
    '.receipts{margin:22px 0 0;padding-top:14px;border-top:1px dashed #b9ac8e;',
    'font:500 12px/1.8 ' + MONO + ';color:#6b6355;}',
    '.receipts b{color:#211d17;font-weight:700;}',
    '.count{font:700 54px/1.1 ' + MONO + ';margin:10px 0 8px;font-variant-numeric:tabular-nums;letter-spacing:-.02em;}',
    // hard block = same document, full ink
    '.hard .card{background:linear-gradient(176deg,#1d1812 0%,#15110c 100%);',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 44px 90px rgba(0,0,0,.7);}',
    '.hard .card::before{background:repeating-linear-gradient(-45deg,#b3261e 0 12px,#0c0a08 12px 24px);height:9px;}',
    '.hard .eyebrow{color:#e5484d;}',
    '.hard .eyebrow .rule{background:#453d31;}',
    '.hard .headline{color:#f5efe2;}',
    '.hard .sub{color:#b0a68f;}',
    '.hard .count{color:#f5efe2;}',
    // ---- spiral interrupt: full inversion, hazard-taped ----
    '.swrap{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;',
    'background:radial-gradient(130% 100% at 50% 0%,#2a0c09 0%,#160705 55%,#0b0403 100%);',
    'color:#f6e7e3;font-family:' + SERIF + ';padding:44px 24px;}',
    '.swrap::before,.swrap::after{content:"";position:fixed;left:0;right:0;height:12px;',
    'background:repeating-linear-gradient(-45deg,#e5484d 0 14px,#180a08 14px 28px);}',
    '.swrap::before{top:0;}.swrap::after{bottom:0;}',
    '.scard{max-width:620px;width:100%;text-align:left;animation:ar-rise .38s cubic-bezier(.22,1,.36,1) both;}',
    '.seyebrow{display:flex;align-items:center;gap:10px;margin:0 0 18px;',
    'font:700 11px/1 ' + MONO + ';letter-spacing:.16em;text-transform:uppercase;color:#ff8a80;}',
    '.seyebrow::before{content:"";width:9px;height:9px;border-radius:50%;background:#ff453a;',
    'animation:ar-pulse 1.1s ease-in-out infinite;}',
    '.shead{font-size:58px;line-height:1.02;font-weight:700;letter-spacing:-.015em;margin:0 0 14px;color:#fdf3f1;}',
    '.ssub{font-size:16.5px;line-height:1.55;color:#dba39a;margin:0 0 24px;}',
    '.ssub b{color:#fdf3f1;font-weight:600;}',
    '.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;margin:0 0 26px;',
    'background:rgba(229,72,77,.38);border:1px solid rgba(229,72,77,.38);}',
    '.tile{background:#160705;padding:16px 18px;}',
    '.tile .n{font:700 38px/1 ' + MONO + ';font-variant-numeric:tabular-nums;color:#ff6f61;}',
    '.tile .l{font:600 10.5px/1.45 ' + MONO + ';letter-spacing:.08em;text-transform:uppercase;color:#b07a71;margin-top:8px;}',
    '.tile.good .n{color:#5dd97c;}',
    '.tile.good .l{color:#4f9e63;}',
    '.ack{width:100%;background:#0f0503;color:#fdf3f1;border:1px solid #6e2a24;border-radius:2px;',
    'padding:14px 16px;font:500 15px/1.4 ' + MONO + ';letter-spacing:.02em;caret-color:#ff453a;outline:none;}',
    '.ack::placeholder{color:#8a5c55;}',
    '.ack:focus{border-color:#ff6f61;box-shadow:0 0 0 3px rgba(255,69,58,.14);}',
    '.abtn{background:#e5484d;color:#180a08;border:none;border-radius:2px;padding:15px 24px;margin-top:16px;',
    'font:700 12.5px/1 ' + MONO + ';letter-spacing:.08em;text-transform:uppercase;cursor:pointer;',
    'box-shadow:3px 3px 0 rgba(229,72,77,.25);}',
    '.abtn:disabled{opacity:.35;cursor:default;box-shadow:none;}'
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
      '<div class="wrap lv' + level + '"><div class="card">' +
      '<p class="eyebrow"><span>Attention Rehab</span><span class="rule"></span><span>' +
      escapeHtml(platform) + ' &middot; feed blocked</span></p>' +
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
      '<div class="wrap hard"><div class="card">' +
      '<p class="eyebrow"><span>Attention Rehab</span><span class="rule"></span><span>Hard block</span></p>' +
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
      // Same ledger language as the overlay: a paper ticket stub, ink type.
      pillEl.style.cssText = 'all:initial;position:fixed;bottom:18px;right:18px;z-index:2147483646;' +
        "background:#f5efe2;color:#211d17;font:700 12px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace;" +
        'letter-spacing:.05em;text-transform:uppercase;padding:9px 13px;border-radius:2px;' +
        'border:1px solid #211d17;box-shadow:2px 2px 0 rgba(0,0,0,.45);' +
        'font-variant-numeric:tabular-nums;pointer-events:none;';
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
    bannerEl.style.cssText = 'all:initial;position:fixed;bottom:18px;left:18px;z-index:2147483646;max-width:300px;' +
      "background:#f5efe2;color:#3d372c;font:500 12px/1.55 ui-monospace,'SF Mono',Menlo,Consolas,monospace;" +
      'padding:12px 14px;border-radius:2px;border:1px solid #211d17;border-left:4px solid #b45309;' +
      'box-shadow:2px 2px 0 rgba(0,0,0,.45);';
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

      if (!cls.blocked && !hard) {
        // Allowed surface — no enforcement, but an active pass keeps its
        // countdown pill visible everywhere on the domain (a pacing cue while
        // composing/searching) and keeps the trail heartbeat going. Expiry
        // here never blocks anything: this surface needs no pass.
        var allPasses = local.activePasses || {};
        var openPass = allPasses[cls.base];
        if (openPass && Date.now() < openPass.endTs) {
          clearOverlay();
          restoreFeed();
          hideBanner();
          showPill(openPass);
          startHeartbeat(openPass);
          schedulePassExpiry(openPass.endTs);
        } else {
          fullClear();
        }
        return;
      }

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
