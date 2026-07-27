# Notification System Audit and Adaptive Local Nudges

**Status:** Executed through Slice 8 code scope — P0 privacy/logout, reconciler, permissions/settings, deterministic candidates, opt-in momentum/pattern candidates, bounded local adaptive timing, and automated verification complete; physical-device verification remains pending
**Scope:** Expo local notifications, permission/settings UX, on-device personalization, lifecycle cleanup/reconciliation, interaction handling, tests, physical-device validation. Remote push infrastructure excluded.

## 1. Goal and assumptions

### Goal
Replace scattered fire-and-forget scheduling with privacy-safe local notification orchestrator. Use longitudinal on-device history to send fewer, better-timed, evidence-gated nudges. Guarantee generic lock-screen copy, deterministic policy, actionable deep links, and account-safe cleanup.

### Assumptions
- Raw entries, wiki content, emotions, topics, challenge titles, and other authored/inferred text never enter OS notification payloads or network calls.
- Notification planning remains on-device. No push token registration, server notification service, analytics SDK, or cloud personalization.
- Preferences and delivery history are device-local for initial implementation. Multi-device global dedupe cannot be guaranteed without remote coordination.
- Expo SDK 52 / `expo-notifications ~0.29.14` stays. Installed package exposes pending-request enumeration, channel/category APIs, delivered-notification dismissal, and last-response clearing; implementation must verify real iOS/Android behavior.
- Current schema ends at migration 034. Proposed migration number is 035 if no concurrent migration lands first.
- OS scheduling is best-effort. Exact delivery, dismissal detection, and execution while app is killed cannot be promised.
- Open events are observable. Reliable delivered/dismissed events are not treated as available signals.

## 2. Situation: confirmed current system

### Durable code paths
- `src/services/notifications/scheduler.ts`
  - `ensurePermission()` reduces permission state to granted/false.
  - `scheduleDailyReminders()` cancels fixed IDs, then arms seven one-shot evening reminders.
  - `scheduleChallengeReminders()` arms fourteen one-shot 09:00 reminders.
  - `scheduleWeeklyDigest()` schedules repeating Sunday reminder regardless of digest eligibility.
  - `sendFirstPageReadyNotification()` sends immediate notification containing page title and wiki route data.
  - `onEntrySaved()` records activity and re-arms daily + digest schedules.
- `src/services/notifications/timing.ts`
  - All-time 24-hour histogram; minimum three evening samples; fixed 17:00–21:00 window; no recency, weekday, outcome, timezone, or quiet-hours model.
- `src/services/notifications/re-engagement.ts`
  - Pure 3/7/30-day classification exists, but no production caller.
- `src/hooks/useJournalEntry.ts:62` and `src/services/pipeline.ts:611`
  - Entry/first-run saves call `onEntrySaved()` fire-and-forget.
- `src/hooks/useChallenge.ts:59,78,82,93`
  - Challenge scheduling/cancellation runs fire-and-forget; failures are not surfaced or reconciled.
- `src/app/_layout.tsx` `AppRoot`
  - Notification response handling recognizes only `wikiId`.
  - Cold-launch response is read but never cleared, so stale response replay is possible.
  - No notification reconciliation on app resume.
- `src/app/_layout.tsx` `AppGate`
  - Notification handler configured before DB open.
  - Authenticated DB gate gives safe place to mount DB-backed orchestrator.
  - Unauthenticated transition closes DB/reset stores but does not clear OS notifications.
- `src/services/auth/auth.service.ts` `logout()`
  - Correctly wipes DB/key/tokens, but does not cancel scheduled/delivered notifications or clear cached response.
- `src/hooks/useSync.ts` `useSync()`
  - Sync runs on mount, resume, reconnect, local change, interval. No post-sync notification reconciliation.
- `src/app/(tabs)/settings.tsx`
  - No notification permission state, categories, timing, quiet hours, pause, privacy preview, or system-settings recovery.
- `src/services/digest/generator.ts`
  - `MIN_ENTRIES_FOR_DIGEST = 7`; `generateDigest()` returns `null` below evidence gate.
- `src/services/insights/mood-stats.ts`
  - `detectWeeklyRhythm()` has recurrence/concentration/day-spread gates.
  - `detectMomentum()` supplies corroborated positive longitudinal signal.
- `src/services/storage/settings.ts`
  - Encrypted per-account settings storage is reusable for validated device-local preferences.
- `src/services/storage/schema.ts` / `src/services/storage/migrations.ts`
  - Latest registered migration is 034.
- `app.json`
  - Expo notifications plugin enabled. No explicit notification channel policy in app code.
- `__tests__/services/notifications/*` and `__mocks__/expo-notifications.js`
  - Pure timing/copy/re-engagement and basic scheduling calls covered; lifecycle and policy behavior are not.

## 3. Problem: weaknesses and loopholes

### P0 — privacy/account isolation
1. **Sensitive lock-screen content:** first-page notification exposes synthesized page title. Title may reveal person, belief, situation, or emotion.
2. **Post-logout leakage:** OS schedules and delivered notifications survive destructive logout. Different account can receive prior account’s reminders.
3. **Sensitive routing payload:** `wikiId` and full route live in OS payload. Payload should contain only opaque candidate ID and allowlisted kind.
4. **Stale cold-start response:** cached response is not cleared after handling and can reopen old content.

### P1 — reliability and relevance
1. No source-of-truth reconciliation against `getAllScheduledNotificationsAsync()`.
2. Concurrent re-arm calls can interleave cancellation/scheduling and leave partial or stale batches.
3. Fixed ID-range cancellation assumes prior batch shape and does not clean unknown legacy/orphaned IDs.
4. Weekly notification claims digest is ready when `generateDigest()` may return `null`.
5. Daily/challenge schedules become stale after timezone/DST travel, remote sync, challenge changes, or missed lifecycle calls.
6. Challenge hook ignores scheduling failures.
7. First-page cancellation only targets scheduled request; already delivered notification remains.
8. No global/category cap, quiet hours, collision handling, priority, expiry, cooldown, or recent-use suppression.
9. Foreground handler always displays alert even while user is active in app.
10. Most notification kinds lack actionable routing.
11. Re-engagement logic is dead code; seven-day reminder buffer stops after lapse.
12. No Android channel setup/verification, no category-action setup, and no physical-device contract tests.

### P1 — permission UX
1. OS prompt happens after first save without explicit in-app explanation or user-selected reminder intent.
2. `notif_permission_asked` is written even if permission API fails transiently, preventing useful retry UX.
3. Provisional iOS authorization is not recognized.
4. Denied, blocked, provisional, and system-disabled states are collapsed into boolean.
5. No settings deep link or status recovery.

### P2 — personalization quality
1. Comment says app opens + entries; production records entry saves only.
2. Histogram never ages out. Old behavior permanently biases timing.
3. Hour-only model ignores weekday, quiet hours, outcomes, chosen habits, and notification fatigue.
4. No opened/downstream-journal feedback loop.
5. Rich longitudinal insights exist but do not drive notification eligibility.
6. Current generic rotation is not tied to freshness or meaningful app state.

### Structural limitation
Local scheduling on every paired device can produce duplicate reminders. Initial scope can reconcile each device after encrypted sync, but cannot guarantee single global delivery while devices are offline. Treat preferences/history as per-device and disclose this; defer active-device lease/server push design.

## 4. Approach: target architecture

### 4.1 Module boundaries
Create focused notification domain under `src/services/notifications/`:

- `types.ts` — allowlisted kinds, candidate, preference, permission-state, suppression-reason types.
- `preferences.ts` — Zod-validated defaults/read/write using encrypted `settings`; device-local.
- `repository.ts` — candidate/event CRUD only; parameterized SQL; no UI imports.
- `candidates.ts` — deterministic candidate generators from entries/wiki/digest/challenge state.
- `policy.ts` — pure eligibility, privacy allowlist, priority, quiet-hour, cap, collision, cooldown, freshness logic.
- `timing.ts` — retain pure timing functions; replace all-time histogram path in later slice with rolling/recency-weighted model.
- `orchestrator.ts` — single-flight `reconcileNotifications(reason, now)`; computes desired requests, diffs OS pending requests, cancels stale requests, schedules missing requests, records count-only outcomes.
- `permissions.ts` — normalized Expo permission status and settings recovery.
- `interactions.ts` — resolve opaque candidate ID after auth/DB open, record open once, return allowlisted app route, clear response.
- `cleanup.ts` — idempotent cancel-all/dismiss-all/clear-response for logout/unauthenticated launch.
- `scheduler.ts` — temporarily retain compatibility exports, then reduce to native adapter/configuration; remove independent policy decisions.
- `useNotifications.ts` — authenticated lifecycle hook mounted by `AppRoot`; launch/resume listeners, response listener, reconciliation triggers.

No service imports UI. Components use hooks.

### 4.2 Local persistence
Add migration 035 only after checking latest registry at implementation time.

#### `notification_candidates` — encrypted DB
Store minimal planning metadata, never text:
- opaque random `id` primary key
- allowlisted `kind`
- deterministic `dedupe_key`
- encrypted-local `target_route` used only after authenticated response handling
- `eligible_at`, `expires_at`, optional `scheduled_for`
- `status` (`eligible`, `scheduled`, `opened`, `suppressed`, `cancelled`, `expired`)
- optional allowlisted `reason_code`
- `created_at`, `updated_at`
- unique index on `dedupe_key`
- index on status/scheduled time

`target_route` may contain local object ID because DB is SQLCipher-protected; it never enters OS payload.

#### `notification_events` — encrypted DB, local-only
Store feedback/activity metadata:
- random `id`
- optional `candidate_id`
- allowlisted `event_type` (`app_active`, `entry_saved`, `scheduled`, `opened`, `suppressed`, `cancelled`)
- optional allowlisted `kind` and `reason_code`
- `occurred_at`

No content, title, emotion, topic, wiki title, account ID, device ID, or copied journal data. Add retention pruning, e.g. rolling 90 days for activity/policy events while candidate dedupe records retain only necessary cooldown horizon.

Do **not** add these tables to `SYNCED_TABLES` initially. Schedules and permission states are device-specific. Document per-device behavior. Revisit only with explicit cross-device product design.

Preferences can live as versioned JSON under settings key such as `notification_preferences_v1`, parsed with Zod and safe defaults. Avoid table solely for one settings object.

### 4.3 OS payload privacy contract
Every request:

```ts
content: {
  title: 'MindWiki',
  body: GENERIC_COPY[kind],
  data: { candidateId: opaqueId, kind: allowlistedKind },
}
```

Forbidden in OS payload/title/body:
- raw entry fields
- wiki title/content/category
- topic, named/inferred emotion, distortion, person/entity labels
- challenge title
- account/device identifiers
- route or target object ID

Personal detail appears only after authenticated unlock inside app. Add unit test that recursively rejects forbidden keys and source-derived strings.

### 4.4 Deterministic policy
Initial defaults, centralized as tested constants:
- Notifications off until explicit contextual opt-in.
- Quiet hours default 21:00–09:00, editable.
- At most one ordinary proactive notification per local day and four per rolling seven days.
- Explicit user-scheduled daily challenge/topic check-in may use separate opt-in allowance, but no two notifications within six hours and maximum two total in one local day.
- Collision priority: user-scheduled check-in > fresh digest/insight > actionable challenge > journal habit > re-engagement > celebration.
- Lower-priority candidate shifts to next valid slot only if still fresh; otherwise suppress with reason.
- Suppress habit/re-engagement after entry today.
- Suppress low-priority nudges if app was active in preceding two hours.
- Expire all source-based candidates when source disappears, is corrected/dismissed/merged, route no longer resolves, or freshness window closes.
- Never create candidates from crisis score, negative mood, inferred distress, diagnostic interpretation, or “streak loss” fear.
- Candidate/policy decisions deterministic for same DB state, preferences, timezone, and `now`.

Constants require product review during implementation; tests encode accepted values.

### 4.5 Reconciliation algorithm

```text
reconcile(reason, now):
  acquire single-flight mutex; coalesce queued reasons
  read normalized permission + preferences
  if unauthenticated/disabled/blocked:
    cancel all MindWiki pending requests
    return count-only result

  record timezone/UTC-offset transition
  load minimal state: last entries, active challenge, eligible digest,
                      changed wiki candidates, longitudinal signals,
                      recent candidate/events
  generate candidates with dedupe keys, evidence gates, freshness windows
  apply recent-use suppression, quiet hours, category/global budgets,
        cooldowns, collision priority, and timing window
  build desired requests using only candidateId + kind payload
  read all pending OS requests
  cancel stale/legacy/orphaned MindWiki requests
  schedule missing/changed desired requests
  verify pending snapshot when supported
  persist statuses/events; return Result<ReconcileSummary>
  release mutex; rerun once if trigger arrived while busy
```

Never cancel unrelated app/third-party requests by loose prefix. During one-time migration cleanup, explicitly recognize current IDs:
- `mindwiki-daily-reminder*`
- `mindwiki-weekly-digest`
- `mindwiki-challenge-*`
- `mindwiki-first-page-ready`

Use stable request ID derived from candidate ID, not shifting slot index.

### 4.6 Lifecycle triggers
Reconcile after:
- authenticated storage becomes ready
- app returns active
- entry save completes
- challenge create/check-in/complete/delete
- sync pass completes, so remote entry/challenge/wiki changes suppress stale reminders
- notification preference or chosen time changes
- timezone/offset change detected on resume
- first-page/wiki synthesis creates eligible “insight ready/changed” candidate
- notification action such as snooze/pause, once added

`AppRoot` is correct mount boundary: auth valid + encrypted DB open. Extend `useSync()` or its authenticated wrapper to call reconcile after `sync()` settles; avoid importing React or notification code into sync service.

### 4.7 Permission/settings UX
Add notification section to `src/app/(tabs)/settings.tsx`, backed by hook:
- current state: not determined / provisional / granted / denied-blocked
- master enable/pause
- categories: journal habit, insights/digest, challenge, re-engagement; celebrations off by default
- preferred reminder window/time
- quiet hours
- private lock-screen preview showing exact generic copy
- “Why this reminder?” explanation for policy/data use, without exposing text
- system settings button when blocked
- optional “Pause for 1 week” and “Less like this” after action-category slice

Replace automatic first-save OS prompt with contextual in-app invitation after demonstrated value. OS prompt only follows explicit user tap. If declined, retain recoverable state; do not repeatedly prompt.

Recognize iOS provisional authorization as schedulable but non-interrupting. Set explicit Android channels before permission request/scheduling:
- `reflection-reminders` low/default importance, no badge, privacy-safe description
- optional separate user-chosen challenge channel only if settings need channel-level control

Channel importance cannot always be lowered after creation; use stable intentional configuration and test upgrade behavior.

### 4.8 Interaction routing
Response flow:
1. Extract only `candidateId` and allowlisted `kind`.
2. Wait for authenticated storage readiness.
3. Atomically mark candidate opened if not already handled.
4. Resolve encrypted-local `target_route` through route allowlist (`/digest`, `/challenge`, `/trends`, `/wiki/[id]`, `/entry` as applicable).
5. Verify referenced target still exists; fall back to safe Home route.
6. Navigate once.
7. Clear last notification response.

If user is logged out, candidate is absent, target stale, or payload invalid: clear response and do not navigate. This prevents cross-account replay.

Foreground receipt should not show another OS alert while user is already active. Initially suppress foreground alert; later in-app banner/inbox may surface eligible item without lock-screen interruption.

### 4.9 Distinctive longitudinal notification methods
All eligibility/ranking stays deterministic and local. Lock-screen copy remains generic.

#### Foundation candidates
1. **Journal habit reminder**
   - Eligible only when enabled, no entry today, within preferred window, under budget.
   - Timing from recent local activity; no mood-based targeting.
   - Generic copy: “A quiet moment to check in, if it would help.”

2. **Challenge action reminder**
   - Eligible only for active challenge and no check-in today.
   - User-selected schedule; completion/deletion immediately invalidates.
   - Never mention title or threatened streak.

3. **Re-engagement ladder**
   - Schedule one-shot D3/D7/D30 candidates from last entry’s local calendar date.
   - One send per tier; stop/cancel after new entry.
   - Support long lapse while app is not opened by arming all valid future tiers, subject to platform pending limits.
   - Non-judgmental copy already exists and can be retained after privacy/cap review.

4. **Digest ready**
   - Candidate only when `generateDigest()` returns non-null (`MIN_ENTRIES_FOR_DIGEST = 7`) and week key has not been opened/notified.
   - No repeating “ready” claim without ready digest.
   - Route `/digest` confirmed present.

5. **Insight ready/meaningfully changed**
   - Candidate after successful page synthesis/version change, not before.
   - Dedupe on page lineage + version; require new grounded evidence or meaningful version increment, not maintenance-only write.
   - Skip dismissed/merged/corrected-invalid targets.
   - Generic copy: “A new insight is ready when you want to explore it.”
   - Replace current first-page title-bearing notification.

#### Later evidence-gated candidates
6. **Positive momentum reflection**
   - Use existing `detectMomentum()` corroboration gates.
   - Notify only positive/constructive momentum, cooldown at least 28 days, and only if category opted in.
   - Generic lock copy; private screen explains actual signals.

7. **Recurring pattern revisit**
   - Use `detectWeeklyRhythm()` only after its recurrence/concentration/day-spread gates.
   - Off by default or grouped under explicit “Patterns” opt-in because inferred distortion is sensitive.
   - Never expose weekday/distortion in notification body.

8. **User-chosen topic check-in**
   - User explicitly selects page/topic and cadence inside app.
   - Notification stays generic; target stored encrypted locally.
   - Stronger user agency than inferred surprise prompts.

9. **Milestone/comeback recognition**
   - Prefer in-app card by default.
   - Optional notification after active-day milestone or first entry after lapse; no streak-loss framing.

Do not implement crisis/inferred-distress notifications, negative mood alerts, diagnostic copy, raw quote resurfacing on lock screen, or graph-person/entity alerts.

## 5. SPARC execution roadmap

### [SPEC] Slice 0 — freeze behavioral contract
1. Define kinds, payload allowlist, preference defaults, caps, quiet hours, priorities, evidence/cooldown rules, and route allowlist.
2. Document observability limits: scheduled/opened/app-active/entry outcomes only; no reliable dismissal claim.
3. Define per-device semantics and legacy cleanup IDs.
4. Verify with review of contract fixtures before source changes.

### [PSEUDO] Slice 1 — pure planner design
Write pseudocode and data-flow fixtures before implementation:
- candidate generation
- local-calendar date arithmetic
- DST/timezone recomputation
- collision/cap resolution
- payload serialization
- response resolution
- logout cleanup fallback

Verify same inputs produce same desired schedule and suppression reasons.

### [ARCH] Slice 2 — storage/native boundaries
1. Add migration 035 candidate/event tables, indexes, constraints, retention behavior.
2. Add repository, preferences, permission normalization, and native adapter interfaces.
3. Keep tables out of sync registry.
4. Expand Expo mock to support pending enumeration, channel/category setup, cancel-all, dismiss-all, response listeners, permission detail, and response clearing.
5. Verify migration registry order, SQLCipher-only metadata, and no service→UI imports.

### [TDD] Slice 3 — failing tests first
Add tests before each implementation unit:

#### Pure policy tests
- generic payload contains only candidate ID + kind
- forbidden source text/IDs never serialize
- quiet-hour boundary and overnight windows
- global/category caps and six-hour spacing
- deterministic priority/collision shifting/expiry
- recent app use and journal-today suppression
- once-per-dedupe/cooldown behavior
- route target expiry and fallback
- no crisis/negative-mood candidate generation

#### Time/calendar tests
- spring-forward missing hour
- fall-back repeated hour
- month/year boundary
- timezone travel and offset-only change
- local D3/D7/D30 tier dates
- rolling-window/recency weighting and insufficient-sample fallback

#### Reconciliation tests
- idempotent repeated reconcile
- stale/legacy/orphan cancellation
- missing desired schedule creation
- no duplicate requests under concurrent triggers
- partial cancel/schedule failure returns `Result` and converges next run
- denied/blocked/disabled state cancels MindWiki requests
- digest absent means no digest request
- active/completed/deleted challenge transitions
- remote entry after sync cancels same-day/lapse candidate
- pending snapshot mismatch handled safely

#### Interaction/lifecycle tests
- opened response records once and navigates once
- cached response clears after valid, stale, malformed, and logged-out paths
- app-active reconciliation and foreground suppression
- post-sync reconciliation
- preference/timezone change reconciliation
- no DB access before authenticated storage ready

#### Logout tests
- cancel scheduled, dismiss delivered, clear cached response before/alongside wipe
- cleanup failure never blocks DB/key/token wipe
- unauthenticated launch retries idempotent native cleanup
- old-account candidate cannot route in new account

#### UI tests
- permission status variants, provisional state, blocked settings link
- explicit opt-in before OS request
- category/pause/quiet-hours changes persist and reconcile
- accessibility labels and exact generic preview

### [IMPL] Slice 4 — P0 privacy/logout patch
Smallest urgent release-safe patch:
1. Make first-page copy generic; remove page title/route/wiki ID from OS payload.
2. Introduce opaque candidate lookup for first-page routing, or disable its deep link until lookup exists.
3. Add `cleanupNotifications()` using cancel-all scheduled, dismiss-all delivered, and clear-last-response.
4. Call cleanup in `logout()` before DB deletion, but never let native failure block wipe.
5. Call cleanup again on unauthenticated launch/state transition for interrupted/best-effort recovery.
6. Clear consumed cold-start response.
7. Verify zero sensitive payload snapshots and logout tests.

### [IMPL] Slice 5 — reconciler and permissions foundation
1. Implement migration/repository/preferences/native adapter.
2. Implement pure planner + single-flight orchestrator.
3. Replace direct daily/digest/challenge batch scheduling with reconcile triggers.
4. Mount `useNotifications()` only inside authenticated `AppRoot`.
5. Reconcile launch/resume/post-sync/entry/challenge/preference/timezone events.
6. Configure Android channel and normalized iOS provisional state.
7. Suppress foreground OS alert.
8. Verify pending schedule equals desired schedule after repeated and failed runs.

### [IMPL] Slice 6 — settings and actionable routing
1. Add explicit opt-in and granular controls to Settings.
2. Add contextual permission invitation; remove automatic prompt from `onEntrySaved()`.
3. Implement opaque candidate response resolution and allowlisted routes.
4. Add pause and private copy preview.
5. Optional next sub-slice: notification categories/actions for snooze and “less like this”; do not block foundation release.
6. Verify UI/accessibility and real system-settings recovery.

### [IMPL] Slice 7 — deterministic personalized candidates
Order:
1. journal habit + challenge
2. D3/D7/D30 re-engagement
3. evidence-gated digest ready
4. insight ready/meaningfully changed
5. positive momentum
6. explicit opt-in pattern/topic candidates
7. in-app milestone/comeback

Each kind gets independent eligibility, privacy, cooldown, stale-source, cap, and routing tests before activation. Ship behind local preference defaults; inferred pattern notifications remain off by default.

### [REFINE] Slice 8 — outcome-aware timing, only after enough local data
1. Record app-active, scheduled, opened, and entry-saved timestamps only.
2. Backfill historical activity from entry timestamps; never backfill inferred notification outcomes.
3. Use rolling eight-week recency-weighted weekday/hour activity after minimum sample/day-spread gate.
4. Later, compare bounded slots by downstream app-open/journal conversion only after sufficient sends; keep user window and quiet hours authoritative.
5. Bound adaptive shift (for example ±90 minutes from chosen time); deterministic fallback when confidence is low.
6. Add retention pruning and count-only local diagnostics.
7. No A/B framework or external telemetry in this scope.

### [REFINE] Slice 9 — accessibility, performance, device hardening
- Screen-reader labels, large text, reduced-motion-safe settings interactions.
- Planner queries bounded by indexed time windows; no full wiki/content scans on every resume.
- Debounce/coalesce rapid entry/sync/lifecycle triggers.
- Validate pending-request limits and battery impact.
- Document channel migration and calendar-trigger limitations.
- Verify app update, OS reboot, force-stop, app kill, timezone travel, DST, denied permissions, and paired-device behavior.

## 6. Verification plan

### Execution status
- Automated tests: `yarn test --runInBand` — 163 suites / 1,527 tests passed.
- Typecheck: `yarn tsc --noEmit` — passed.
- Lint: `yarn lint` — passed with 64 pre-existing warnings; changed-file lint passed with zero errors/warnings.
- Physical-device matrix: not run in this session; requires iOS/Android dev-client or release devices.
- Deferred by hardware/product scope: physical-device verification, explicit user-chosen topic check-ins, milestone/comeback notifications, notification actions/inbox, and active-device cross-device lease design.

### Automated
Run serially due project Jest guidance:
1. Targeted notification unit/integration suites.
2. Migration/storage tests.
3. Relevant auth/logout, sync, journal, challenge, digest, and app-layout tests.
4. Full `yarn test`.
5. `yarn tsc --noEmit`.
6. `yarn lint` if existing baseline permits; report unrelated baseline failures separately.

### Privacy checks
- Snapshot/assert every OS request payload.
- Static grep for notification content constructed from page title, entry fields, emotion, distortion, topic, challenge title, or route.
- Confirm no notification table added to sync queue and no network import in notification domain.
- Confirm logs expose only error codes/counts/reason enums.

### Physical-device matrix
Test release/dev-client builds, not Expo Go:

#### iOS
- not determined → grant; provisional; deny; blocked → Settings recovery
- foreground/background/terminated tap
- delivered notification cleanup on logout
- DST/timezone travel
- reboot/app update persistence
- lock-screen preview with notification previews enabled/disabled

#### Android
- Android 13+ runtime permission
- channel creation/importance and channel-disabled state
- foreground/background/terminated tap
- force-stop/reboot behavior
- battery optimization/doze timing tolerance
- logout cleanup and account switch
- timezone/DST change

#### Cross-device
- entry written on device B syncs to device A; A reconciliation cancels stale reminder after sync
- document unavoidable duplicate window while devices are offline
- logout/account switch never routes old candidate or reveals old text

## 7. Acceptance criteria

### Privacy/security
- Zero raw/user-derived text or sensitive identifiers in OS notification title/body/data.
- First-page and all later insight notifications use generic lock-screen copy by default.
- Logout invokes cancel scheduled + dismiss delivered + clear cached response; unauthenticated launch retries cleanup.
- Old-account notification cannot navigate or resolve after account switch.
- Notification planning/history never leaves device and never enters sync registry.

### Reliability
- Reconcile is idempotent and single-flight.
- No duplicate request IDs or same-window collisions after repeated triggers.
- Pending OS state converges after partial failure on next reconcile.
- DST/timezone cases produce future local-calendar times inside configured window.
- Digest notification exists only when current digest passes seven-entry gate.
- Completed/deleted challenge and new entry remove stale relevant requests.
- Cached notification response is consumed once and cleared.

### User control
- No OS prompt without explicit user action.
- Granted/provisional/denied/blocked states shown accurately.
- Master/category controls, pause, timing window, and quiet hours persist.
- User can see exact generic lock-screen preview and explanation of local data use.
- Default caps/cooldowns prevent notification flooding.

### Personalization quality
- Re-engagement tiers send at most once and stop after new entry.
- Insight/digest/pattern/momentum candidates pass documented evidence/freshness gates.
- Timing adapts only after minimum sample threshold and remains inside user constraints.
- No crisis, inferred distress, diagnosis, manipulative streak-loss, or negative-mood-triggered notifications.

### Engineering
- New service APIs return `Promise<Result<T>>`; no thrown service errors.
- Strict TypeScript, no `any`, parameterized SQL, transactional multi-table writes.
- Tests cover policy, migration, lifecycle, failure recovery, privacy, permissions, routing, logout, DST/timezone, sync, and UI.
- Full tests/typecheck pass; iOS + Android physical-device checklist recorded.

## 8. Risks and mitigations

- **OS delivery is not exact:** communicate reminders as windows, not guarantees; reconcile whenever app can run.
- **Dismissal not reliably observable:** optimize only from scheduled/opened/app-active/entry events; never infer dismissal.
- **App killed for long periods:** arm bounded future one-shot re-engagement candidates; accept OS limits.
- **Multi-device duplicate sends:** reconcile after sync; document per-device controls; defer remote lease/push coordinator.
- **Migration growth/event volume:** index time/status, retain minimal enums/timestamps, prune old local events.
- **Adaptive feedback bias:** require minimum sample/day spread, bound shifts, retain user-selected window and deterministic fallback.
- **Permission/channel state divergence:** query OS state on every settings open/resume; never trust stored boolean alone.
- **Logout native cleanup failure:** generic payload means no content leak; retry cleanup unauthenticated; never block cryptographic wipe.

## 9. Rejected alternatives

- **Remote push service now:** adds tokens/server coordination and privacy/ops surface without need for local evidence-gated nudges.
- **Cloud LLM notification copy:** violates on-device privacy model and creates uncontrolled sensitive text.
- **Raw wiki/topic/emotion lock-screen copy:** high shoulder-surfing risk; private detail belongs after unlock.
- **Single repeating weekly/daily triggers:** cannot validate current eligibility, suppress after activity, resolve collisions, or expire stale state.
- **Syncing local outcome tables immediately:** permission/delivery state is device-specific and cross-device conflict semantics are undefined.
- **Full notification inbox/action system in foundation:** valuable later, but not required to fix privacy, logout, reconciliation, and permission UX.
- **Mood/crisis-triggered nudges:** risks harmful inference, surveillance feel, and clinical implication; explicitly prohibited.
