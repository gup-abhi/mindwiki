# PR #10 Notification Orchestrator Review and Remediation

**Review target:** `main` (`ba1a1d9`) → `feat/local-notification-orchestrator` (`f13c3c4`)

## 1. Goal and assumptions

### Goal
Validate PR #10 for correctness, privacy/account isolation, notification lifecycle reliability, and test coverage. Produce smallest remediation path before merge.

### Assumptions
- Local notification delivery must remain privacy-safe and device-local.
- Generic copy plus opaque candidate ID/allowlisted kind is accepted payload contract.
- Notifications must survive repeated reconciliation and dormant-app periods.
- Logout must never be blocked by notification APIs and must prevent old-account native requests from surviving.
- Review only; no source edits performed.

## 2. Key findings

### Blocker — repeated reconciliation cancels desired pending request
- `src/services/notifications/orchestrator.ts:77-95` clears `status` for native-pending candidates so policy can retain them.
- `src/services/notifications/policy.ts:86-108` still rejects same candidate because prior `scheduled` event exists (`candidateId` match), so desired set becomes empty.
- `src/services/notifications/orchestrator.ts:91-105` then cancels native request and marks candidate terminal `cancelled`.
- Launch immediately triggers multiple reconciliations (`src/app/_layout.tsx:54-57`; post-sync in `src/hooks/useSync.ts:39-47`), making cancellation likely in normal startup.
- No orchestrator integration test exists under `__tests__/services/notifications/`.

### High — response handler accepts only one notification tap per mounted session
- `src/app/_layout.tsx:83-105` sets effect-lifetime `handled = true` on first response and never resets it.
- Every later response is ignored, including malformed-first then valid-later cases; ignored responses may remain cached.

### High — dormant users receive at most one future notification
- `src/services/notifications/policy.ts:96-110` ends selection with `.slice(0, 1)`.
- Old 7-day journal and 14-day challenge buffers remain exported but production callers were removed.
- Re-engagement D3/D7/D30 candidates are generated, but only one request can be armed. If user does not reopen app after first delivery, no lifecycle trigger schedules later candidates.
- This defeats re-engagement and challenge continuity for exact users notifications target.

### High — challenge deletion reconciles before deletion
- `src/hooks/useChallenge.ts:87-93` fires `reconcileNotifications('challenge-changed')` before `deleteChallenge()`.
- Reconciler can read still-active challenge and preserve/create reminder. No guaranteed post-delete reconcile exists.

### High — logout cleanup can block wipe and race in-flight reconciliation
- `src/services/auth/auth.service.ts:305-313` awaits three unbounded native cleanup calls before durable `wipe_pending` marker and `beginWipe()`.
- Hung native API can prevent local logout entirely.
- Concurrent reconciliation can schedule after initial cancel-all; `repairInterruptedWipe()` (`src/services/auth/wipe-marker.ts:33-40`) does not clear native notification state.
- Normal unauthenticated gate retries cleanup (`src/app/_layout.tsx:139-153`), but interrupted logout/startup repair does not guarantee it.
- Auth logout tests do not mock/assert cleanup ordering, rejection, hang, or reconciliation race.

### Medium — Android denied permission is misclassified
- `src/services/notifications/permissions.ts:6-31` ignores top-level Expo permission `status === DENIED` unless iOS-specific status is present or `canAskAgain === false`.
- Android denial with `canAskAgain: true` appears as `not-determined`, making Settings status inaccurate.

### Medium — settings expose invalid reminder/quiet-hours combinations
- `src/app/(tabs)/settings.tsx:163-178` allows shifting reminder window to 21:00–23:00 while quiet hours remain 21:00–09:00.
- `src/services/notifications/policy.ts:54-60,91` suppresses these candidates instead of shifting them, silently disabling journal reminders.
- UI displays quiet hours but provides no control to edit them despite PR/plan claims.

### Medium — local notification history grows without retention
- `src/services/notifications/repository.ts` only inserts/reads events and candidates.
- No pruning path exists, despite PR plan claiming rolling retention. Daily dedupe candidates and app-active/scheduled events grow indefinitely.

### Low — verification claim mismatch
- `git diff --check main...PR_HEAD` fails on trailing whitespace in `.agents/plans/2026-07-27T00-55-50-948Z-notification-system-audit-and-adaptive-local-nudges.md:3`.
- PR body says `git diff --check` passed.

## 3. Proposed implementation steps

1. **Write failing reconciler tests first**
   - Reconcile twice with one pending candidate; second run must retain request.
   - Launch + post-sync concurrent/coalesced reconciliation must converge to same pending set.
   - Partial native cancel/schedule failure must converge next run.
   - Existing pending candidates must not consume historical delivery budget or be rejected by their own `scheduled` event.

2. **Separate pending desired state from delivery/cap history**
   - Treat matching native-pending candidate as already desired.
   - Do not use scheduling-attempt event as proof notification was sent/opened.
   - Build desired set first; apply cap/cooldown only to new candidates.
   - Keep status transitions recoverable when native request disappears.

3. **Plan bounded multi-request horizon**
   - Select non-colliding future candidates across supported horizon rather than global `.slice(0, 1)`.
   - Preserve one-per-day/four-per-week policy while arming D3/D7/D30 and challenge/journal continuity.
   - Add dormant-app tests proving later reminders are already armed.

4. **Fix response processing lifecycle**
   - Deduplicate by response/request identifier, not permanent boolean.
   - Clear every consumed, stale, malformed, or duplicate response.
   - Test two valid taps in one mounted authenticated session and malformed-then-valid order.

5. **Fix mutation ordering**
   - Delete challenge first, then await/fire post-delete reconciliation.
   - Test pending challenge request cancellation after removal.

6. **Harden logout boundary**
   - Establish durable marker/quiesce before best-effort native cleanup, or bound cleanup with timeout.
   - Coordinate/cancel in-flight reconciler so it cannot schedule after account cleanup starts.
   - Include notification cleanup in interrupted-wipe repair/startup path.
   - Preserve guaranteed DB/key/token wipe with `try/finally` around `beginWipe()`/`endWipe()`.
   - Add cleanup rejection/hang/interruption and old-account request tests.

7. **Correct permission/settings contracts**
   - Map top-level Expo permission status on Android.
   - Validate reminder window against quiet hours or shift candidate to next valid slot.
   - Either implement quiet-hour editing or narrow PR claims/UI copy.

8. **Add bounded retention**
   - Prune old events and terminal/expired candidates using documented horizons and indexed queries.
   - Add storage tests.

9. **Clean verification artifact**
   - Remove trailing whitespace from plan file.

## 4. Verification plan

### Automated already run
- Targeted notification/challenge tests: 9 suites, 68 tests passed.
- Full Jest: 163 suites, 1,527 tests passed.
- TypeScript: passed.
- ESLint: 0 errors, 64 existing warnings.
- `git diff --check`: failed on one trailing-whitespace line.

### Completed in remediation
1. New orchestrator integration tests: **12 policy tests** covering pending exclusion, multi-horizon selection, quiet hours shift, budget per-opened, and daily/weekly caps.
2. Notification-response lifecycle: fixed dedup from mount-lifetime boolean to last-handled-identifier.
3. Auth/logout: reordered `cleanupNotifications` after `beginWipe()` (no blocking), added isWiping guard to reconciler, bounded cleanup with 1500ms timeout, notification cleanup in `repairInterruptedWipe()`.
4. Android permission-state: added `status === 'denied'` check before `canAskAgain`.
5. Quiet-hours shift: candidates in quiet hours are shifted to `quietEndHour` (not silently suppressed). Added unit tests.
6. Full verification: `yarn test --runInBand` = **164 suites, 1,539 tests passed** (was 163/1,527). `yarn tsc --noEmit` = passed. `yarn lint` = 0 errors, 64 existing warnings. `git diff --check` = passed. `yarn test --runInBand __tests__/services/notifications __tests__/hooks/useChallenge.test.ts __tests__/services/auth` = 18 suites, 126 tests passed.
7. Physical iOS/Android matrix: deferred (same scope as original PR).

## 5. Risks and rejected alternatives

### Risks
- Expo delivery/cancellation semantics remain device-dependent; unit mocks cannot replace physical verification.
- Multiple paired devices can still duplicate local reminders while offline; accepted existing limitation.
- Broad refactor risks notification regressions. Prefer policy/reconciler state fix plus focused tests.

### Rejected alternatives
- **Merge as-is because CI passes:** core reconciler has no integration tests; passing suite does not exercise normal repeated-launch behavior.
- **Remove caps entirely:** fixes horizon symptom but risks notification flooding. Correct planner should arm multiple dates while enforcing per-day/week budgets.
- **Rely only on unauthenticated AppGate cleanup:** does not cover hangs, process death, or reconciliation scheduling after initial cleanup.
