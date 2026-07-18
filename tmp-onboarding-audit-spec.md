# Onboarding Flow Audit & Improvement Spec (TEMPORARY — delete after triage)

> Audited 2026-07-17 against `main` @ `6d2a0df`. Covers everything from cold install
> to the first "aha" (first wiki page), plus how well the funnel reflects the
> product's core features to a brand-new user.

---

## 1. Current flow (as implemented)

```
Install → AuthScreen (register: email + password + confirm)
        → RecoveryPhraseView (12 words, checkbox-gated)
        → [encrypted DB opens]
        → OnboardingCarousel (5 slides, skippable)
        → onDone: beginOnboardingModelDownload()  (fast → deep → embed, fire-and-forget)
        → useFirstRunRedirect → /paths/overwhelmed?firstRun=1  (4 prompts, forced)
        → finish: capturePathAnswers → crisis check → markFirstRunComplete
        → firstWikiPage() polls 20s → /wiki/<id>?firstRun=1 ("This is your wiki" card)
          └─ on timeout → "Nicely done" → Home (WhatChangedCard as fallback)
```

Key files:
- Gate & ordering: `src/app/_layout.tsx`
- Tour: `src/components/onboarding/OnboardingCarousel.tsx`
- First-run logic: `src/services/onboarding/first-run.ts`, `src/hooks/useFirstRunRedirect.ts`
- Funnel path: `src/app/paths/[id].tsx`, `src/hooks/useGuidedPath.ts`, `capturePathAnswers` in `src/services/pipeline.ts`
- Fallbacks on Home: `ModelDownloadCard`, `WhatChangedCard`, `RecoverySetupCard`

### What's already good
- Resume-after-kill of the guided path (`FIRST_RUN_STARTED` marker, per-account, wiped on logout).
- Staged model download (fast unblocks journaling; deep triggers `triggerCatchUp()` to heal path entries).
- Crisis routing has priority over the aha-moment redirect.
- Defensive guards: existing entries short-circuit first-run; blank-answer path still marks complete (no loop trap).
- Recovery phrase is checkbox-gated and honestly worded.

---

## 2. Weaknesses (ranked by impact)

### W1 — The "aha moment" usually cannot happen on a real first run  [HIGH]
`firstWikiPage()` polls 20s for a synthesized page, but synthesis needs the **deep
model (~2 GB)**, whose download only *starts* when the carousel is dismissed. A user
finishing the 4-prompt path in 3–6 minutes on typical Wi-Fi almost always beats the
download. Result: the flagship moment — routing to your first wiki page with the
"This is your wiki" card — silently degrades to a 20s spinner ("Finding your first
insight page…") followed by a generic "Nicely done" screen for the majority of users.
The one screen designed to prove "the wiki is the product" is the one most users
never see. (`deepReady` was once computed for this and is now unused — prior
observation confirms nothing gates the poll on model presence.)

### W2 — Reflect (companion chat) is absent from onboarding entirely  [HIGH]
The carousel's 5 slides cover wiki, CBT writing, insight growth, patterns, privacy.
**Reflect — a core differentiating feature and its own tab — is never mentioned**,
and nothing in the first-run funnel touches it. A new user discovers it only by
tapping an unexplained "Reflect" tab, where (pre-download) the model isn't ready and
the response is an error pointing them back to Home. Same for Connections (graph):
only obliquely referenced ("connections between what keeps coming up").

### W3 — Kill during the carousel loses the entire funnel  [HIGH]
`FIRST_RUN_STARTED` is only set inside `firstRunStatus()`, which runs *after* the
carousel is dismissed. `isNewAccount` is session-only. So: register → phrase → kill
app during carousel → relaunch hydrates as a returning session → no carousel, no
guided path, **and no model download ever starts automatically** (it's only kicked
from the carousel's `onDone`). The user lands on an empty Home whose only rescue is
the ModelDownloadCard. The whole new-user funnel evaporates on one early kill.

### W4 — The first-run path is a forced funnel with no exit  [MEDIUM-HIGH]
`useFirstRunRedirect` uses `router.replace`, so there is no screen underneath, and
the path runner renders no close/skip affordance — only Back (from step 2) and a
Finish button that is disabled until something is answered. A skeptical user who
tapped "Skip" on the tour is still dropped straight into "What's taking up the most
space in your head right now?" with no visible way out. On Android, hardware back
likely exits the app. This is a churn trap for exactly the users who need the most
convincing.

### W5 — "Skip" silently consents to a ~2.8 GB download  [MEDIUM-HIGH]
The download-consent copy renders **only on the last slide**, but `onDone` (which
starts the download) also fires from the Skip button on slide 1. A user who skips
never sees the disclosure yet triggers the download. Additionally the copy promises
"over Wi-Fi", but there is **no network-type check anywhere** in
`model-manager.ts` / `useModelDownload` (NetInfo is only used by sync) — on cellular
the 2.8 GB proceeds anyway. Consent claim ≠ behavior.

### W6 — First-run users get no notification permission ask and no reminders  [MEDIUM]
The habit system arms itself in `onEntrySaved()` (permission ask, `recordActivity`,
daily reminders, weekly digest), which is called only from `useJournalEntry` — i.e.
only on a **journal** save. `capturePathAnswers` never calls it. A user whose only
day-one activity is the guided path (the designed funnel!) is never asked for
notification permission and has zero reminders scheduled → the retention loop never
starts for the exact cohort onboarding creates.

### W7 — Degraded-model moments inside the funnel are silent  [MEDIUM]
During the first-run path (models still downloading):
- "✨ Go deeper" → `deepenReflection` fails → chip shows "Thinking…" then nothing.
  Feels broken; the user's very first AI interaction is a silent no-op.
- Crisis scoring (`scoreCrisis`, fast model) fails → falls to keyword net only.
  Acceptable as a net, but a known degradation window worth acknowledging in design.

### W8 — One hardcoded path, one CTA mismatch, no feature discovery after  [LOW-MED]
- The first run always uses `overwhelmed`. Fine as a default, but the pinned framing
  ("what's piling up") won't fit, e.g., a curious/calm evaluator.
- Final carousel CTA says "Start journaling" but actually starts a guided
  reflection — small trust dent.
- After the funnel there is zero progressive discovery: no coachmarks or one-time
  hints for Reflect, You (insights/Connections), digest, challenges, streak freezes,
  belief reframes, or evolution. The carousel is the only teaching moment and it is
  100% front-loaded before the user has any context.
- The tour can never be re-viewed (no "replay tour" entry in Settings).

### W9 — Account-first friction before any demonstrated value  [LOW, strategic]
Email + password + confirm + 12-word phrase + checkbox all come before the user has
seen a single screen of product. This is by design (mandatory auth, zero-knowledge
escrow) and not proposed for change here — but it raises the stakes on W1–W4:
everything after that wall must land, because the user has already paid a high cost.
(PocketPal competitive note: "reduce onboarding friction" was flagged as an idea
worth stealing.)

---

## 3. Proposed improvements (spec)

Ordered to match the weaknesses. Each is independently shippable.

### P1 — Make the aha moment model-aware (fixes W1)
**Behavior**: In the path runner's finish flow (firstRun only):
- If deep model is present → poll as today (20s).
- If deep model is absent or still downloading → skip the poll entirely. Show a
  purpose-built completion state: "Your first insights are being woven in — your
  private AI is still arriving (X%)" with the deep-model progress bar, and a single
  "Take me home" CTA. Home's `WhatChangedCard` + the existing `triggerCatchUp()`
  already complete the loop when the model lands.
- New: when catch-up finishes synthesizing the *first-run* entries specifically,
  fire one local notification (if permitted) and/or a one-time Home banner:
  "Your first insight page is ready → [page title]" deep-linking to
  `/wiki/<id>?firstRun=1` so the "This is your wiki" moment is *deferred, not lost*.

**Edge cases**: model download failed → banner not shown, ModelDownloadCard remains
the retry surface. Entries all blank → nothing to announce (existing behavior).

**Verify**: unit-test finish flow with `isModelDownloaded('deep')` mocked
false → no poll, deferred-banner marker set; integration: catch-up sets the
banner/notification exactly once.

### P2 — Introduce Reflect (and Connections) in the funnel (fixes W2)
- Add one carousel slide for Reflect ("Talk it through — a companion that knows
  your patterns, not the internet's") between "Insights that grow" and "See the
  patterns"; adjust the patterns slide to name Connections explicitly.
- After the first-run completion screen (both variants), add a secondary link:
  "Later, try Reflect →" that routes to the Reflect tab **only when models are
  ready**; otherwise omit it (don't advertise a broken door).

### P3 — Move first-run markers earlier + decouple the download kick (fixes W3)
- Set `FIRST_RUN_STARTED` (or a new `onboarding:tour_pending`) immediately after
  registration confirm (when the DB is first open) rather than after the carousel.
  On relaunch, `tour_pending` && !complete → re-show the carousel, then continue the
  normal funnel.
- Call `beginOnboardingModelDownload()` from AppRoot whenever
  (first run incomplete && models missing && download not started), not solely from
  the carousel's `onDone`. The function is already idempotent per session.

**Verify**: kill app on carousel slide 2 → relaunch → carousel re-shows, download
resumes/starts; returning login on new device unaffected (markers are per-account
DB settings, wiped on logout — existing property preserved).

### P4 — Give the forced path an exit (fixes W4)
- Path runner, when `firstRun=1`: add a quiet header affordance "Explore on my own"
  (top-right). Tapping it calls `markFirstRunComplete([])` and routes Home.
- Android hardware back inside a first-run path = same action (never exit-app).

**Tradeoff**: slightly lower funnel completion vs. not trapping skeptics; the funnel
keeps its default momentum (affordance is deliberately low-emphasis).

### P5 — Honest download consent (fixes W5)
Pick one (decision needed):
- **(a) Gate on Wi-Fi** (matches current copy): add NetInfo check in
  `beginOnboardingModelDownload` / `useModelDownload.download`; on cellular, defer
  and surface the ModelDownloadCard in a "waiting for Wi-Fi (or tap to use mobile
  data)" state. Adds a dependency on network-state correctness.
- **(b) Fix the copy** (matches current behavior): consent line becomes "…downloads
  the on-device AI (~2.8 GB). Best on Wi-Fi." — simpler, no gating.
Either way: **Skip must not start the download silently.** On Skip, show the same
one-line consent as an inline confirm (or defer entirely to the Home card, which
already discloses size).

### P6 — Arm the habit loop from the guided path (fixes W6)
In the first-run finish flow (or `capturePathAnswers` for path saves generally):
call `onEntrySaved(Date.now())` (it already self-gates the permission ask to once,
records activity, and schedules reminders). Path completions already count toward
the streak; the notification system should see them too.

**Verify**: complete first-run path on fresh install → permission prompt appears
once, daily reminders scheduled; second path run → no re-prompt.

### P7 — Degrade "Go deeper" honestly (fixes W7)
If `deepenReflection` fails (model absent), replace the silent no-op with an inline
caption: "Your private AI is still downloading — deeper prompts unlock soon." Hide
the chip entirely when the deep model is known-absent during first run (cheap
`isModelDownloaded('deep')` check on mount).

### P8 — Post-funnel progressive discovery (fixes W8, cheap version)
- One-time dismissible hint cards (settings-flagged, like `FIRST_RUN_FLAG`):
  - You tab, first visit: "Your insight pages live here; Connections shows how they
    relate."
  - Reflect tab, first visit with models ready: one-line intro + a starter chip.
- Rename final carousel CTA to "Begin" or "Start reflecting".
- Settings → "Replay the welcome tour" row (renders `OnboardingCarousel` modally,
  without the download side-effect).

### Explicitly out of scope
- Any change to mandatory auth / recovery-phrase-first (W9) — strategic, revisit
  with Phase 9 paywall design since trial conversion pressure compounds it.
- New guided-path content, path choice screen (W8 hardcoded path): defer; P1/P4
  reduce the harm of a mismatched path.

---

## 4. Suggested order of work

| # | Item | Size | Risk |
|---|------|------|------|
| 1 | P1 model-aware aha + deferred banner | M | low |
| 2 | P6 habit loop from path | S | low |
| 3 | P3 marker timing + download kick decoupling | S-M | medium (touches gate logic — needs the resume tests) |
| 4 | P4 funnel exit | S | low |
| 5 | P5 consent (decision a/b first) | S | low |
| 6 | P2 Reflect slide + completion link | S | low |
| 7 | P7 go-deeper degradation | S | low |
| 8 | P8 discovery hints + replay | M | low |

Open decisions for you:
1. P5: gate on Wi-Fi (a) or fix copy (b)?
2. P1: notification vs. Home banner vs. both for the deferred first-page moment?
3. P4: is "Explore on my own" acceptable, or should first-run stay exit-less by design?
