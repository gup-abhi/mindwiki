# Cold-Start Launch Risk — Spec

**Author:** User (analysis + three proposals)  
**Date:** 2026-07-08  
**Status:** Draft — spec + TDD tests only, no implementation  

---

## Problem

Day-1 funnel: create account → download ~2–3 GB models → write an entry → and the product's selling point is still invisible because the wiki needs several entries to be interesting.

Every competitor (Rosebud, Ash) delivers their "wow" in minute one. MindWiki's compounding-knowledge model has no way to make its promise tangible in the first session.

**Constraint:** Time-to-first-insight ≤ first session.

---

## Current state (already shipped, not re-spec'd)

These pieces exist and are verified (production code, not stubs):

| Piece | Where | Shipped |
|-------|-------|---------|
| `capturePathAnswers(answers)` | `pipeline.ts` | Yes — creates `source:'path'` entries, indexes immediately (no recurrence gate), returns crisis assessment |
| `catchUpUnindexed()` | `pipeline.ts` | Yes — 3-pass self-heal (untagged → wiki-pending → graph-pending), fires at bootstrap |
| `WhatChangedCard` | `components/home/` | Yes — shows reshaped wiki pages from most recent tagged entry, tappable |
| `lineageForEntry` | `wiki/engine.ts` | Yes — returns live wiki pages an entry shaped |
| `OnboardingCarousel` | `components/onboarding/` | Yes — 5-slide tour, fires `onDone()` |
| `ModelDownloadCard` + `useModelDownload` | `components/` + `hooks/` | Yes — but all-or-nothing (fast→deep→embed sequential, hides only when all done) |
| `PathRunnerScreen` | `app/paths/[id].tsx` | Yes — steps through path, finish → "/" or "/crisis" |
| `isModelDownloaded(kind)` | `llm/model-manager.ts` | Yes — per-model check |
| `WikiPage route` | `app/wiki/[id].tsx` | Yes — renders a wiki page by ID |
| Synthetic `"Synthesizing…"` indicator | Home `index.tsx:198` | Yes — uses `wikiStore.pending > 0` |

### What does NOT yet exist

| Gap | Affects proposal |
|-----|------------------|
| No "first-run path" concept — carousel → AppRoot directly | P1 |
| No wiki-page routing on path completion (done screen → "/") | P1 |
| No polling for first wiki page after async synthesis | P1 |
| `areModelsReady()` requires **both** fast + deep — app can't start partial | P2 |
| `catchUpUnindexed` is bootstrap-only — never fires mid-session | P2 |
| `useModelDownload` has one `ready` boolean — no per-model visibility | P2 |
| No download-completion callback for the deep model | P2 |
| No "start with fast model, download deep behind" UX path | P2 |

---

## Proposal 1: First-run guided path

A completed path yields 3–5 entries in one sitting (already indexed immediately, no recurrence gate) → after ten minutes the user has 2–3 real wiki pages and a small graph. End the path by routing them to their first page.

### Architecture

The app already has a carousel (`OnboardingCarousel`) and a path runner (`PathRunnerScreen`) — the gap is the **orchestration layer** between them and the **wiki-page routing** at the end.

```
[Login] → [Carousel] → [First-run path] → [Wiki page] → [App is Home]
                     markOnbordingSeen()  poll for page    WhatChangedCard
                     set firstRunFlag     "This is your    already live
                                          wiki." aha card
```

### New service: `onboarding/first-run.ts`

```
src/services/onboarding/first-run.ts    ← new
src/services/onboarding/seen.ts         ← exists (hasSeenOnboarding + markOnboardingSeen)
```

Three functions, all best-effort / never throw:

```typescript
/**
 * Check the first-run status after the carousel is dismissed.
 * Returns whether a first-run path should run, which path to use,
 * and whether the deep model is ready (drives the post-path polling
 * timeout).
 */
export async function firstRunStatus(): Promise<{
  shouldRun: boolean       // false once firstRunComplete flag is set
  pathId: string           // e.g. "overwhelmed" — the most onboarding-friendly path
  deepReady: boolean       // is the deep model downloaded? affects poll timeout
}>

/**
 * Mark the first run as complete. Stores the created entry IDs so
 * firstWikiPage can find the resulting page. Sets a settings flag
 * so firstRunStatus().shouldRun returns false on subsequent launches.
 * Best-effort, never throws.
 */
export async function markFirstRunComplete(
  entryIds: string[]
): Promise<void>

/**
 * Poll for the first wiki page created from a set of entries. Used by
 * the completion flow to route the user to their first insight page.
 * Times out after pollTimeoutMs (default: 20s on Wi-Fi, 60s on cellular;
 * simplified default 20s). Returns null on timeout — caller falls back
 * to Home (WhatChangedCard picks it up when ready).
 *
 * Polls every 2s by calling lineageForEntry for each entry and
 * collecting resulting pages, returning the first one found.
 */
export async function firstWikiPage(
  entryIds: string[],
  pollTimeoutMs?: number
): Promise<{ id: string; title: string } | null>
```

### Routing changes

**`_layout.tsx`** — After carousel onDone, currently:
```tsx
onDone={() => { void markOnboardingSeen(); setOnboarded(true) }}
```

New behavior: still mark as seen + setOnboarded(true) (so AppRoot renders), but **AppRoot (or Home) detects the `firstRun` flag and redirects**:
```tsx
// In AppRoot or a new useFirstRunRedirect hook:
const firstRun = await firstRunStatus()
if (firstRun.shouldRun) {
  router.replace(`/paths/${firstRun.pathId}?firstRun=1`)
}
```

**`paths/[id].tsx`** — After finish, currently:
```tsx
setCompleted(true) // shows "Nicely done" → "/"
```

New: detect `firstRun=1` param. On finish:
1. `const answers = [...collected answers]`  
2. `const crisis = await capturePathAnswers(answers)` — existing, returns crisis
3. Look up entry IDs from answers (capturePathAnswers returns void — need to expose)
4. `await markFirstRunComplete(createdEntryIds)`
5. `const first = await firstWikiPage(createdEntryIds, /* poll */)`
6. If first found → `router.replace(`/wiki/${first.id}?firstRun=1`)` — shows "This is your wiki" card
7. If timeout → `router.replace('/')` — WhatChangedCard picks it up
8. Crisis routing still takes priority (tier ≥ 2 → /crisis)

### Edge cases

- **Deep model still downloading**: poll timeout increased; fallback to Home (WhatChangedCard shows pages when synthesis completes)
- **User interrupts mid-path**: path has no persistence (current behavior), firstRun flag stays untouched → next launch still triggers first run
- **All answers blank**: `capturePathAnswers` no-ops → still mark first run as complete (don't trap user in a loop) but route to Home, not wiki page
- **Synthesis fails for all pages**: firstWikiPage times out → route to Home

---

## Proposal 2: Staged model download

**Gate first-run on the fast model + embed model only (small); the deep model downloads in the background while the user does the onboarding path.**

### The problem with today's download

```
areModelsReady() = fast && deep   // 940 MB + 1.9 GB = ~2.8 GB
useModelDownload: fast → deep → embed  // all-or-nothing
```

A new user on a slow connection waits 5+ minutes staring at a download progress bar before writing a single word.

### New readiness gate

```typescript
// In services/llm/model-manager.ts — add:

/**
 * True when enough models are present to start journaling.
 * Only the fast model is required (crisis scoring + fast tags + embeddings).
 * The deep model (wiki synthesis) downloads in the background.
 * The embed model (Reflect semantic retrieval) is optional.
 */
export async function canStart(): Promise<boolean> {
  return isModelDownloaded('fast')
}

/**
 * True when the deep model is also present — full knowledge-base
 * indexing (wiki synthesis + graph) is available.
 */
export async function isFullyReady(): Promise<boolean> {
  return isModelDownloaded('fast') && isModelDownloaded('deep')
}
```

`areModelsReady()` stays unchanged — it gates `catchUpUnindexed` and Reflect conversation, which genuinely need the deep model.

### Download phase

The `useModelDownload` hook (or a new `useModelStages`) drives a multi-phase download:

```
Phase 0: fast model   → gate: canStart() = true   → card shows "ready to go, deep model downloading..."
Phase 1: deep model   → gate: isFullyReady() = true  → card hides (if embed also done)
Phase 2: embed model  → optional, best-effort
```

### On deep model ready — mid-session catch-up

Currently `catchUpUnindexed()` runs once at bootstrap. If the deep model finishes mid-first-run-path, the entries the user just wrote need to be indexed.

```typescript
// In services/llm/model-manager.ts — add:

type DeepModelCallback = () => void
let _deepReadyCallbacks: DeepModelCallback[] = []

/** Register a callback that fires when the deep model finishes downloading. */
export function onDeepModelReady(cb: DeepModelCallback): void {
  _deepReadyCallbacks.push(cb)
}

export function clearDeepModelReadyCallbacks(): void {
  _deepReadyCallbacks = []
}
```

Call `_deepReadyCallbacks` from the download completion path in `downloadModel()` when `kind === 'deep'`.

```typescript
// In services/pipeline.ts — add:

/**
 * Mid-session catch-up: trigger when the deep model finishes downloading
 * during an active session. Safe to call multiple times — pass 1 (untagged)
 * skips entries already tagged, and passes 2+3 skip entries already
 * wiki/graph-indexed. Best-effort, never throws.
 */
export async function triggerCatchUp(): Promise<void> {
  // Delegate directly; all three passes snapshot their target lists so
  // re-entry is safe.
  await catchUpUnindexed()
}
```

**Why `triggerCatchUp` is a separate public function rather than calling `catchUpUnindexed` directly:** naming concerns — `catchUpUnindexed` is the bootstrap variant that couples model-check + catch-up. A mid-session caller already knows the deep model just arrived, so the model check inside `catchUpUnindexed` is redundant. But for simplicity, just delegating to it is fine — the model check is cheap (file stat), and the re-entrant guard inside each pass prevents issues.

### Card UX

`ModelDownloadCard` already conditionally renders (`ready !== false`). Extend it:

- **`ready === null`** (checking): same as today — transparent
- **`canStart() === false`**: show download prompt (same as today)
- **`canStart() === true && isFullyReady() === false`**: show "Models ready — finishing up deep model…" card with secondary progress
- **`isFullyReady() === true`**: hide card (same as today)

The `useModelDownload` hook gains:
```typescript
{
  ready: boolean | null,       // current: areModelsReady()
  canStart: boolean | null,    // new: canStart()
  depthProgress: number | null // new: downloads 0..1 for deep model when active
}
```

---

## Proposal 3: Home "What changed" (already done)

**Verified in production code** — `WhatChangedCard` at `src/components/home/WhatChangedCard.tsx`, wired into Home `index.tsx:143`.

WhatChangedCard:
- Reads `lineageForEntry(lastTaggedEntry)` 
- Renders reshaped page chips, each tappable to `/wiki/${id}`
- Falls back through entries to find one with topics set
- Renders nothing if null or empty

**No spec work needed** for this proposal. The only gap is that a brand-new user (zero entries) sees nothing — but after the first-run path creates entries + synthesis completes, the card lights up immediately since `lineageForEntry` and `useEntries` react to new data.

---

## Acceptance criteria (map to TDD tests)

| # | Criterion | Test |
|---|-----------|------|
| P1-1 | `firstRunStatus()` returns `shouldRun: true` on fresh install | `firstRunStatus returns shouldRun true on fresh install` |
| P1-2 | `firstRunStatus()` returns `shouldRun: false` after `markFirstRunComplete()` | `markFirstRunComplete persists the flag for subsequent checks` |
| P1-3 | `firstWikiPage()` returns a page when synthesis completes in time | `firstWikiPage returns page when lineage has results within timeout` |
| P1-4 | `firstWikiPage()` returns null after timeout | `firstWikiPage returns null on timeout` |
| P1-5 | `markFirstRunComplete()` stores entry IDs | `markFirstRunComplete stores entry IDs` |
| P2-1 | `canStart()` returns true when only the fast model is present | `canStart returns true with fast model only` |
| P2-2 | `canStart()` returns false when no models present | `canStart returns false when no models are present` |
| P2-3 | `onDeepModelReady()` fires when downloadModel completes deep | `onDeepModelReady fires after deep model completes` |
| P2-4 | `triggerCatchUp()` delegates to `catchUpUnindexed()` | `triggerCatchUp delegates to catchUpUnindexed` |
| P2-5 | Catch-up trigger fires from downloadModel completion | `downloadModel triggers onDeepModelReady for deep model` |
| P3 | Already verified in production | No test needed |

---

## What is NOT in scope

- **Adding a `GuidedPath` field for first-run affinity** — all paths produce entries; "overwhelmed" is hand-picked as broadest appeal, but any path works. The `pathId` is a constant.
- **Persistence of in-progress path answers** — leaving mid-path discards them (same as today).
- **Cloud LLM fallback** — all model inference stays on-device.
- **Analytics / funnel tracking** — no SDK for user-authored text (privacy model).
- **Changing the deep model** — still Qwen2.5-3B; staging is about download order, not model swap.

---

## Implementation order

1. `model-manager.ts` — add `canStart()`, `onDeepModelReady`, `clearDeepModelReadyCallbacks`, wire callbacks into `downloadModel`
2. `onboarding/first-run.ts` — `firstRunStatus`, `markFirstRunComplete`, `firstWikiPage`
3. `pipeline.ts` — `triggerCatchUp`
4. `useModelDownload` hook — expose `canStart`, split download phase
5. `ModelDownloadCard` — staged rendering
6. `_layout.tsx` + Home — first-run routing detection
7. `paths/[id].tsx` — first-run completion → wiki page routing

Each step has TDD tests in `__tests__/services/onboarding/first-run.test.ts`.

---

## File manifest

```
NEW:  src/services/onboarding/first-run.ts    — firstRunStatus, markFirstRunComplete, firstWikiPage
NEW:  __tests__/services/onboarding/first-run.test.ts — TDD tests for all three proposals

MOD:  src/services/llm/model-manager.ts       — add canStart(), onDeepModelReady, clearDeepModelReadyCallbacks
MOD:  src/services/pipeline.ts                — add triggerCatchUp
MOD:  src/hooks/useModelDownload.ts           — expose canStart, multi-phase progress
MOD:  src/components/ModelDownloadCard.tsx    — staged rendering
MOD:  src/app/(tabs)/index.tsx                — detect firstRun flag + redirect
MOD:  src/app/paths/[id].tsx                  — first-run completion → wiki page routing
MOD:  src/app/_layout.tsx                     — pass firstRun context into AppRoot
```
