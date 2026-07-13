# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Attention Rehab is a Chrome MV3 extension. **v2/v3 rebuild:** the unit of blocking is a
*surface* (a feed), not a whole site. x.com/compose is a tool; x.com/home is a slot machine —
same domain, opposite jobs. See `V2-DESIGN.md` for the full rationale and phase plan. This is
**Phase 1**: surface-level blocking, non-destructive enforcement, draft guard, sentence-pass, trail log.

This is now **Phase 2** on top of Phase 1: escalating per-hour pass friction, a real-time
spiral/binge interrupt, and trail-based receipts on the pass panel.

Vanilla JS, no build system, no npm. Rationale goes in commit messages, not inline comments.

## Architecture

### Files

- **surface-rules.js** — the brain of "what counts as a blocked surface." Shared by the content
  script (injected) and the service worker (`importScripts`); attaches everything to `globalThis.AR`.
  Per-platform path classification for X/Twitter and YouTube; generic whole-domain block for
  user-added domains; scope matching; the vocabulary handed to the model.
- **receipts.js** — pure, deterministic summaries over the trail log; attaches `globalThis.ARReceipts`
  (depends on `AR`, loaded after surface-rules.js in both worlds). `summarize(trailLog)` →
  `{passesToday, minutesToday, passesLastHour, minutesLastHour, week:{passes,clean,drifted,topDriftHour},
  cleanStreak}`. Also `isBinge(summary)` (spiral trigger) and `escalationLevel(passesLastHour)`
  (friction ladder). A "drifted" pass = one whose trail has an out-of-scope, blocked-surface event.
  This module is the seed of the future offline judge (Phase 3) — no I/O, all pure functions.
- **enforce.js** — the content script (runs at `document_start` on x/twitter/youtube statically,
  and on user-added domains via dynamic registration). Does all enforcement in-page: hides the feed
  element + shows a full-viewport **shadow-DOM** overlay. Detects SPA route changes (history hooks +
  `yt-navigate-finish` + 1s poll) and re-evaluates every surface without a reload. Draft guard,
  countdown pill, corner banner, heartbeat trail logging.
- **background.js** — service worker. The pass office (Anthropic Haiku call + graceful keyword
  fallback), pass lifecycle + expiry alarms, trail log, per-hour analytics, and dynamic
  content-script registration for user-added domains. **Never** reloads or navigates a tab.
  Also runs spiral detection: after every grant and heartbeat, `maybeTriggerSpiral()` re-summarizes
  the trail and, if `isBinge` trips and the 1-hour cooldown has elapsed, writes `spiralSignal`
  (with a precomputed summary) + `lastSpiralTs` to local storage. The content script renders it.
- **popup.html / popup.js** — manage blocked domains + hard block; requests host permission for
  user-added domains; link to options.
- **options.html / options.js** — set the Anthropic API key (`chrome.storage.sync.apiKey`).

### Enforcement contract (hard rules)

1. **Never** `chrome.tabs.reload` or navigate a tab to block. All enforcement is in-page.
2. **Draft guard:** if any visible textarea/contenteditable has non-empty text (or a composer is
   open), ALL enforcement defers — a small corner banner shows instead of the overlay, and the
   overlay only returns once the draft is cleared. Never destroy work.
3. Overlay lives in a shadow root so site CSS can't break it.

### Surfaces

- **X / Twitter** — blocked: `/`, `/home`, `/explore`, `/i/trending`. Allowed (no pass): compose,
  notifications, messages, search, `/<user>/status/<id>`, profiles, settings.
- **YouTube** — blocked: `/` (home feed), `/feed/*` (except `/feed/subscriptions`), `/shorts/*`.
  Allowed: `/watch`, `/results`, channel pages, subscriptions.
- **Other (user-added) domains** — whole-domain block, enforced in-page via overlay.

### Escalating friction (Phase 2)

Computed from passes granted in the trailing 60 min (`ARReceipts.escalationLevel`). **1st pass:**
sentence + grant, one click. **2nd:** panel shows a "2nd pass this hour" badge and requires an
explicit extra confirm step before the request is sent. **3rd+:** a mandatory 60-second wait
(visible countdown, textarea + button disabled) plus pushback copy showing the hour's/today's
receipts, then the ask unlocks. The ladder resets on its own as passes age out of the window.

### Spiral interrupt (Phase 2)

Background flags a binge — 3+ passes granted within 60 min **OR** >20 cumulative minutes on blocked
feeds within the hour — and writes `spiralSignal`. The content script renders a full-screen receipts
moment (distinct red/amber treatment, not the normal overlay): visits today, minutes on feeds today,
passes this hour, and the clean-day streak (or drifted count). Dismiss requires typing a fixed
acknowledgment sentence. Fires at most once per hour (background cooldown), and the content script
**never** shows it while the draft guard is active — it defers via the draft recheck, same as
enforcement.

### Receipts on the pass panel (Phase 2)

The pass overlay always shows a one-line receipt ("Nth visit today · X min on feeds today") plus a
"last 7 days" line (passes, clean vs drifted, most common drift hour) — all from `ARReceipts`.

### Sentence-pass

Overlay asks "What are you here for?". On submit → background calls Anthropic
(`claude-haiku-4-5-20251001`) → strict JSON `{durationMinutes 1-30, scopeSurfaces[], label}`. With
no key or on any API error, it falls back to parsing a duration from the text (default 5, cap 30)
and scopes to the requested surface — the flow feels identical. A pass is keyed by base domain in
`chrome.storage.local.activePasses`; while active and the current surface is in scope, the overlay
stays down and a countdown pill shows.

### Data model (chrome.storage)

- **sync**: `blockedSites` (array of `{site, hardBlock, hardBlockExpiry}`; legacy string entries
  migrated on load), `apiKey`.
- **local**: `activePasses` (`{ [domain]: pass }`), `trailLog` (`{ passes: [{passId, domain,
  intent, label, scopeSurfaces, startTs, endTs, events:[{url, ts, dwellMs, inScope}]}] }`, pruned
  to 30 days), `passData` (`{ [YYYY-MM-DD]: { [hour]: {count, minutes} } }` — v1 analytics spirit),
  `spiralSignal` (`{id, ts, summary}` — the current unacknowledged binge), `spiralAck` (the id of
  the last dismissed signal), `lastSpiralTs` (spiral cooldown clock).

### Hard block

Domain-level, 7-day, no passes — shows the overlay with just a countdown to expiry (no pass panel).

## Development

Load unpacked at `chrome://extensions/` (Developer mode). Fresh installs seed `x.com` and
`youtube.com` into `blockedSites`. Syntax-check with `node --check <file>.js` (no build step).

## Not yet built (Phase 3)

The live intent-vs-behavior judge — real-time drift callouts and adaptive tightening that learns
your spiral signature (time of day, entry point, pass cadence), gated on offline accuracy. The trail
log + `receipts.js` are its training ground: the deterministic summaries there are the seed. See
`V2-DESIGN.md`.
