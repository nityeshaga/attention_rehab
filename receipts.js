// receipts.js — deterministic summaries over the trail log. Pure functions,
// no I/O: this is the seed of the future offline judge (Phase 3). Runs in both
// worlds (content script + service worker) and depends on AR (surface-rules.js
// must load first). Attaches globalThis.ARReceipts.

(function () {
  var HOUR_MS = 60 * 60 * 1000;
  var DAY_MS = 24 * HOUR_MS;
  var SPIRAL_PASS_THRESHOLD = 3;      // 3+ passes granted within the hour
  var SPIRAL_MINUTES_THRESHOLD = 20;  // OR >20 cumulative min on feeds this hour
  var WAIT_SECONDS = 60;              // level-3 mandatory wait

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function startOfDay(now) {
    var d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function isBlockedUrl(url) {
    try {
      var cls = AR.classify(url);
      return !!(cls && cls.blocked);
    } catch (e) { return false; }
  }

  // Minutes of dwell on blocked feeds across all events at/after sinceTs.
  function feedMinutes(passes, sinceTs) {
    var ms = 0;
    passes.forEach(function (p) {
      (p.events || []).forEach(function (ev) {
        if ((ev.ts || 0) < sinceTs) return;
        if (isBlockedUrl(ev.url)) ms += (ev.dwellMs || 0);
      });
    });
    return ms / 60000;
  }

  // A pass "drifted" if its trail contains an out-of-scope, blocked-surface
  // event. Returns that first drift event (or null = clean).
  function driftEventOf(pass) {
    var evs = pass.events || [];
    for (var i = 0; i < evs.length; i++) {
      if (evs[i].inScope === false && isBlockedUrl(evs[i].url)) return evs[i];
    }
    return null;
  }

  // Consecutive clean days (zero passes granted) counting back from yesterday.
  function cleanStreak(passes, now) {
    var days = {};
    passes.forEach(function (p) { days[dayKey(p.startTs || 0)] = true; });
    var streak = 0;
    var d = new Date(startOfDay(now) - DAY_MS); // yesterday
    for (var i = 0; i < 365; i++) {
      var k = dayKey(d.getTime());
      if (days[k]) break;
      streak++;
      d = new Date(d.getTime() - DAY_MS);
    }
    return streak;
  }

  function summarize(trailLog, now) {
    now = now || Date.now();
    var passes = (trailLog && trailLog.passes) || [];
    var todayKey = dayKey(now);
    var hourAgo = now - HOUR_MS;
    var weekAgo = now - 7 * DAY_MS;

    var passesToday = 0, passesLastHour = 0;
    passes.forEach(function (p) {
      var st = p.startTs || 0;
      if (dayKey(st) === todayKey) passesToday++;
      if (st >= hourAgo) passesLastHour++;
    });

    var minutesToday = feedMinutes(passes, startOfDay(now));
    var minutesLastHour = feedMinutes(passes, hourAgo);

    // Last 7 days: clean vs drifted, and the most common drift hour.
    var week = passes.filter(function (p) { return (p.startTs || 0) >= weekAgo; });
    var clean = 0, drifted = 0, driftHours = {};
    week.forEach(function (p) {
      var de = driftEventOf(p);
      if (de) {
        drifted++;
        var h = new Date(de.ts).getHours();
        driftHours[h] = (driftHours[h] || 0) + 1;
      } else {
        clean++;
      }
    });
    var topDriftHour = null, topN = 0;
    Object.keys(driftHours).forEach(function (h) {
      if (driftHours[h] > topN) { topN = driftHours[h]; topDriftHour = parseInt(h, 10); }
    });

    return {
      passesToday: passesToday,
      minutesToday: Math.round(minutesToday),
      passesLastHour: passesLastHour,
      minutesLastHour: Math.round(minutesLastHour),
      week: { passes: week.length, clean: clean, drifted: drifted, topDriftHour: topDriftHour },
      cleanStreak: cleanStreak(passes, now)
    };
  }

  // Binge trigger for the spiral interrupt.
  function isBinge(summary) {
    return summary.passesLastHour >= SPIRAL_PASS_THRESHOLD ||
      summary.minutesLastHour > SPIRAL_MINUTES_THRESHOLD;
  }

  // Escalation level for the NEXT pass, from passes already granted this hour.
  // 0 -> level 1 (one click). 1 -> level 2 (extra confirm). 2+ -> level 3
  // (60s wait + pushback). Ladder resets naturally as passes age out of window.
  function escalationLevel(passesLastHour) {
    if (passesLastHour <= 0) return 1;
    if (passesLastHour === 1) return 2;
    return 3;
  }

  globalThis.ARReceipts = {
    summarize: summarize,
    isBinge: isBinge,
    escalationLevel: escalationLevel,
    WAIT_SECONDS: WAIT_SECONDS
  };
})();
