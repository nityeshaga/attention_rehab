# Attention Rehab v2 — Design Brief

*Drafted by Luo Ji, 2026-07-14, from first principles after reading v1 end to end.*

## The job to be done

Not "block distracting websites." The real job:

> **Let me use these platforms deliberately (create, look something up, reply) while making it impossible to slide into compulsive feed consumption without noticing.**

v1 treats the *site* as the unit of danger. The site was never the problem — the **feed** is. x.com/compose is a tool; x.com/home is a slot machine. Same domain, opposite jobs.

## Why v1 fails (diagnosis)

| v1 mechanism | Failure mode |
|---|---|
| Domain-level block + interstitial | Intent-blind: writing a tweet costs the same as doomscrolling |
| Timed passes (1/5/15 min) | No escalation — pass #7 is as cheap as pass #1; friction becomes ritual |
| Pass expiry = tab reload | **Destroys working drafts.** The tool punishes the productive path hardest |
| Usage charts on the block page | Passive analytics → wallpaper. One scroll and you're immune |
| Hard block (7-day) | All-or-nothing; can't hard-block the feed while keeping compose |

The deep flaw: v1 is a **static wall**. Addiction is dynamic — it escalates within a session, within an hour. A static wall trains you to climb it; the climbing becomes muscle memory.

## v2 core principles

1. **Block surfaces, not sites.** The unit of blocking is the *feed*, at URL-path and DOM level. Compose, notifications, DMs, search, a specific tweet you followed from elsewhere, your own profile — allowed by default. Home/For You/Explore/Shorts/Reels — blocked.
2. **Never destroy work.** No tab reloads, ever. Enforcement = overlay/de-render the feed element, scroll-lock, gray-out. If a composer is open or a textarea has unsaved text, the extension waits. Hard rule.
3. **Escalating friction, not flat friction.** First pass of the hour: one click. Second: type what you're going for. Third: a 60-second wait + pushback. The wall gets taller as the behavior gets more compulsive — that's the shape of the actual problem.
4. **Interrupt the spiral in real time.** When the pattern matches a binge (e.g. 3+ passes in an hour, scroll velocity high, dwell long, late night), don't log it for a chart — intervene *now*: full-screen moment with the receipts ("6th visit today, 42 min total"), and optionally a Slack DM from me.
5. **AI as the pass office.** Passes become a conversation, not a button. "I need 10 min to find that thread about Rails testing" → scoped pass granted → the agent watches whether behavior matches stated intent (URL trail: search/thread pages ✅, /home dwell ❌) and calls it: "You said research. You've been on For You for 4 minutes." This is the adaptive layer v1 couldn't have — a static blocklist can't judge intent; a model can.

## What stays from v1

The insight that **full blocking fails** — passes-with-friction is right, only the friction curve and granularity are wrong. Also the honest-with-yourself tone of the copy. Keep both.

## Architecture sketch (MV3, no backend to start)

- **Surface rules** per platform: path patterns + DOM selectors, e.g. X: block `/home`, `/explore`, For You timeline element; allow `/compose/*`, `/notifications`, `/messages`, `/search`, `/<user>/status/*` (arrived-from-elsewhere), own profile. YouTube: block homepage feed + Shorts shelf; allow watch pages reached via search/external link, subscriptions optional.
- **Content script** does surgical enforcement (hide/replace feed nodes, overlay) — never navigation-level for allowed surfaces. `declarativeNetRequest` only as backstop.
- **Session brain** (background worker): tracks per-hour pass count, visit trail, dwell. Heuristics first (cheap, deterministic); Claude API call only at the pass-negotiation and spiral-judgment moments. Escalation ladder lives here.
- **Draft guard**: content script flags "composer active / unsaved input" → all enforcement defers until it clears.
- **Weekly narrative** instead of live charts: a short written debrief (could be me, in Slack) — "worst hour was Tue 11pm, 9 passes; compose sessions stayed clean." Story > graph for someone who's gone chart-blind.

## The AI pass office — sequencing decision (Nityesh, 2026-07-14)

Most of "watching" is deterministic: the background worker sees every navigation, the content script reports dwell/scroll. AI is needed at exactly two moments: (1) parsing a sentence like "10 min to find that Rails thread" into a scope (on-task surfaces + budget) — one cheap model call (deepseek-v4-flash via OpenRouter); (2) phrasing callouts/summaries. Everything between is an `if` statement.

The risk of annoyance lives in *live* drift-nudging, so the judge starts **offline**: trails are logged silently, and a summary agent replays them into receipts shown where they'll be encountered (block page, morning brief) — e.g. "14 'quick research' passes this week; 9 clean; 5 ended on For You within 3 min — all after 10pm." Live callouts ship later, as a toggle, only once offline data proves detection is accurate.

**Decision: sentence-pass + trail logging move into Phase 1, since logging is free and trails are the training ground for the future live judge.**

## Build plan (each phase ships usable)

1. **Phase 1 — Surface-level blocking, draft guard, sentence-pass, trail log.** Path/DOM rules for X + YouTube; non-destructive enforcement (no more lost drafts); pass request = a sentence, parsed by a small model into a scoped pass (graceful keyword-based fallback when no API key is configured); silent URL-trail logging during every pass.
2. **Phase 2 — Escalation + spiral interrupt + receipts.** Per-hour escalating pass friction; real-time binge detection with the receipts screen (fed by trail log); trail-based weekly receipts on the block page.
3. **Phase 2.5 — Hard block rebuilt** (spec in [issue #2](https://github.com/nityeshaga/attention_rehab/issues/2)): surface-level locks, natural-boundary durations, 24h-delay unlock, offered at the moment of failure (spiral screen / level-3 wait), and trail-proposed quiet hours. Principle: flexible going in, rigid once inside.
4. **Phase 3 — Live judge.** Intent-vs-behavior matching in real time, adaptive tightening (learns *your* spiral signature — time of day, entry point, pass cadence). Gated on offline accuracy.

## Phase 1 — SHIPPED (2026-07-14)

Built on branch `v2-rebuild`, version `3.0.0-phase1`. Surface rules for X + YouTube, non-destructive
shadow-DOM overlay enforcement (no reloads), draft guard, sentence-pass (model + keyword fallback),
and silent trail logging. Whole-site fallback for user-added domains, enforced in-page. Old
navigation flow (`blocked.html` / `hard-blocked.html` / `content.js` / `timer.js`) removed. See
`CLAUDE.md` for the file-by-file architecture.

## Phase 2 — SHIPPED (2026-07-14)

Version `3.0.0-phase2` on `v2-rebuild`. Three pieces, all inside the Phase 1 architecture
(shadow-DOM overlay, no reloads, draft-guard supremacy):

- **Escalating friction.** Passes in the trailing 60 min drive a ladder (`ARReceipts.escalationLevel`):
  1st = one click; 2nd = badge + explicit second confirm; 3rd+ = mandatory 60s wait (input disabled,
  visible countdown) + pushback receipts. Resets as passes age out of the window.
- **Spiral interrupt.** Background detects a binge (3+ passes / hour OR >20 min on feeds / hour),
  writes `spiralSignal`; the content script shows a distinct full-screen receipts moment (visits
  today, feed minutes today, passes this hour, clean-day streak). Dismiss = type a fixed
  acknowledgment sentence. At most once/hour; never over an active draft.
- **Receipts on the pass panel.** One-line "Nth visit today · X min on feeds today" + a "last 7 days"
  line (passes, clean vs drifted, top drift hour), all from the new `receipts.js` — the deterministic
  seed of the Phase 3 offline judge.

New file: `receipts.js` (pure summary functions over the trail log, both worlds). New local-storage
keys: `spiralSignal`, `spiralAck`, `lastSpiralTs`.

Keep this CLAUDE.md-adjacent doc up to date with decisions as they're made.
