import { getEntry } from '@/services/storage/entries'
import { getSetting, setSetting } from '@/services/storage/settings'
import { getDb } from '@/services/storage/db'
import { lineageForEntry } from '@/services/wiki/engine'
import { areModelsReady, downloadModel, isModelDownloaded } from '@/services/llm/model-manager'
import { useAuthStore } from '@/store/auth.store'

// Settings keys (persisted across sessions, never synced).
const FIRST_RUN_FLAG = 'onboarding:first_run_complete'
const FIRST_RUN_STARTED = 'onboarding:first_run_started'
const FIRST_RUN_ENTRY_IDS = 'onboarding:first_run_entry_ids'
const MODEL_DOWNLOAD_PREFERENCE = 'onboarding:model_download_preference'
export type ModelDownloadPreference = 'undecided' | 'deferred' | 'consented'

export async function getModelDownloadPreference(): Promise<ModelDownloadPreference> {
  const res = await getSetting(MODEL_DOWNLOAD_PREFERENCE)
  if (!res.success) return 'undecided'
  if (res.data === 'deferred' || res.data === 'consented') return res.data
  return 'undecided'
}

export async function setModelDownloadPreference(preference: Exclude<ModelDownloadPreference, 'undecided'>): Promise<void> {
  await setSetting(MODEL_DOWNLOAD_PREFERENCE, preference).catch(() => undefined)
}

// One-shot marker carrying the first synthesized wiki page's {id,title} so Home
// can surface a deferred "your first insight page is ready" banner/notification
// after the deep model finishes — the aha moment, deferred not lost.
export const FIRST_RUN_PAGE_READY = 'onboarding:first_run_page_ready'
const ANNOUNCE_POLL_TIMEOUT_MS = 10_000

// The path most suitable for a first-run — broad appeal, 4 prompts (not
// too long), no specific external event needed.
const FIRST_RUN_PATH_ID = 'overwhelmed'

// Poll every 2s for the first wiki page. 20s total = 10 polls before timeout.
const POLL_INTERVAL_MS = 2_000
const DEFAULT_POLL_TIMEOUT_MS = 20_000

export interface FirstRunStatus {
  /** True on fresh install (flag not set). Once marked complete, always false. */
  shouldRun: boolean
  /** The guided path ID to route the user through for their first run. */
  pathId: string
}

/**
 * Lightweight existence check — is there at least one row in the entries
 * table? Exported for testability (tests mock this directly instead of the
 * DB layer). Best-effort: returns false on failure.
 */
export async function hasExistingEntries(): Promise<boolean> {
  try {
    const res = await getDb().execute('SELECT COUNT(*) AS c FROM entries LIMIT 1')
    return Number(res.rows[0]?.c ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Check whether the post-registration writing flow should run and which guided
 * path to use.
 *
 * A first run should run when EITHER:
 *  - This session just registered a fresh account (isNewAccount), OR
 *  - A prior session began the guided path but never finished it — the durable
 *    FIRST_RUN_STARTED marker is set while FIRST_RUN_FLAG (complete) is not.
 *    This is the resume-after-kill case: isNewAccount is session-only and a
 *    kill+reopen hydrates as a returning session, so the flag alone would lose
 *    an in-progress cold start.
 *
 * In all cases it's suppressed once the completion flag is set. The STARTED
 * marker lives in per-account encrypted settings, so logout's DB wipe clears it
 * — an existing account signing in on a new device never inherits it.
 *
 * On the first (new-account) run, persists FIRST_RUN_STARTED so the path can be
 * resumed if the app is killed before markFirstRunComplete.
 */
export async function firstRunStatus(): Promise<FirstRunStatus> {
  // Already finished: never re-run, regardless of session or markers.
  const complete = await getSetting(FIRST_RUN_FLAG)
  if (complete.success && complete.data === '1') {
    return { shouldRun: false, pathId: FIRST_RUN_PATH_ID }
  }

  const isNewAccount = useAuthStore.getState().isNewAccount

  // Resume-after-kill: a prior session started the path but didn't complete it.
  // The marker is per-account (DB settings, wiped on logout), so only the very
  // account that began the cold start can resume it.
  if (!isNewAccount) {
    const started = await getSetting(FIRST_RUN_STARTED)
    if (!(started.success && started.data === '1')) {
      // Not a new-account session and no in-progress path → returning user.
      return { shouldRun: false, pathId: FIRST_RUN_PATH_ID }
    }
  }

  // Defensive: a brand-new account starts with an empty DB. If entries somehow
  // exist, treat it as already-onboarded rather than re-running the path.
  if (await hasExistingEntries()) {
    await setSetting(FIRST_RUN_FLAG, '1').catch(() => undefined)
    return { shouldRun: false, pathId: FIRST_RUN_PATH_ID }
  }

  // Mark the path as started so a kill before completion can resume it.
  await setSetting(FIRST_RUN_STARTED, '1').catch(() => undefined)

  return {
    shouldRun: true,
    pathId: FIRST_RUN_PATH_ID,
  }
}

/**
 * Mark the first run as complete. Stores the created entry IDs so
 * firstWikiPage can find the resulting page. Sets a settings flag so
 * firstRunStatus().shouldRun returns false on subsequent launches.
 *
 * Best-effort, never throws.
 */
export async function markFirstRunComplete(entryIds: string[]): Promise<void> {
  await setSetting(FIRST_RUN_FLAG, '1')
  await setSetting(FIRST_RUN_ENTRY_IDS, JSON.stringify(entryIds))
}

/** True iff the post-registration writing flow hasn't marked complete — the gate
 *  the decoupled download kick (AppRoot) uses on launch. Best-effort: treats read
 *  failure as "incomplete". */
export async function isOnboardingIncomplete(): Promise<boolean> {
  const res = await getSetting(FIRST_RUN_FLAG)
  return !(res.success && res.data === '1')
}

/**
 * Store the first synthesized wiki page so Home can show a deferred banner after
 * the deep model finishes. Best-effort, never throws.
 */
export async function markFirstRunPageReady(pageId: string, title: string): Promise<void> {
  await setSetting(FIRST_RUN_PAGE_READY, JSON.stringify({ id: pageId, title })).catch(
    () => undefined
  )
}

/**
 * Read (and clear) the deferred first-page-ready marker. One-shot: a second call
 * returns null so the banner/notification never re-fires. Returns null on miss or
 * parse error (treated as already-announced). Best-effort, never throws.
 */
export async function getFirstRunPageReady(): Promise<{ id: string; title: string } | null> {
  try {
    const res = await getSetting(FIRST_RUN_PAGE_READY)
    if (!res.success || !res.data) return null
    // Clear unconditionally first so a crash mid-read can't re-announce.
    await setSetting(FIRST_RUN_PAGE_READY, '').catch(() => undefined)
    const parsed: unknown = JSON.parse(res.data)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { id?: unknown }).id === 'string' &&
      typeof (parsed as { title?: unknown }).title === 'string'
    ) {
      return parsed as { id: string; title: string }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Called from catch-up after the deep model heals first-run entries. If the
 * first run is complete AND those entries have now synthesized into a wiki page,
 * record the page-ready marker and return it so the caller fires a notification.
 * Idempotent across passes: once the marker is set, subsequent calls return null.
 * Best-effort, never throws.
 */
export async function announceFirstRunPageIfPending(): Promise<{ id: string; title: string } | null> {
  try {
    // Only for a completed first run; an in-progress run's path runner routes live.
    const complete = await getSetting(FIRST_RUN_FLAG)
    if (!(complete.success && complete.data === '1')) return null

    // Already announced — don't re-fire.
    const existing = await getSetting(FIRST_RUN_PAGE_READY)
    if (existing.success && existing.data) return null

    const idsRes = await getSetting(FIRST_RUN_ENTRY_IDS)
    if (!idsRes.success || !idsRes.data) return null
    let entryIds: string[] = []
    try {
      const parsed: unknown = JSON.parse(idsRes.data)
      if (Array.isArray(parsed)) entryIds = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      return null
    }
    if (entryIds.length === 0) return null

    const page = await firstWikiPage(entryIds, ANNOUNCE_POLL_TIMEOUT_MS)
    if (!page) return null
    await markFirstRunPageReady(page.id, page.title)
    return page
  } catch {
    return null
  }
}

/**
 * Generic one-time-hint helpers (progressive discovery, P8). `key` is namespaced
 * under `hint:` so it never collides with first-run markers. Best-effort.
 */
const HINT_PREFIX = 'hint:'
export async function getHintSeen(key: string): Promise<boolean> {
  const res = await getSetting(`${HINT_PREFIX}${key}`)
  return res.success && res.data === '1'
}

export async function markHintSeen(key: string): Promise<void> {
  await setSetting(`${HINT_PREFIX}${key}`, '1').catch(() => undefined)
}

/**
 * Poll for the first wiki page created from a set of entries. Used by the
 * completion flow to route the user to their first insight page. Times out
 * after pollTimeoutMs (default 20s on Wi-Fi — most synthesis finishes in
 * 4–12s). Returns null on timeout — caller falls back to Home (WhatChangedCard
 * picks it up when ready).
 *
 * Polls every 2s by calling lineageForEntry for each entry and collecting
 * resulting pages, returning the first one found. Stops polling on first hit.
 */
export async function firstWikiPage(
  entryIds: string[],
  pollTimeoutMs: number = DEFAULT_POLL_TIMEOUT_MS
): Promise<{ id: string; title: string } | null> {
  if (entryIds.length === 0) return null
  // No deep model ⇒ synthesis can't have produced a page yet. Skip the poll
  // entirely so the finish flow can defer the aha moment instead of spinning
  // uselessly for 20s against a guaranteed timeout.
  if (!(await isModelDownloaded('deep'))) return null

  const deadline = Date.now() + pollTimeoutMs

  while (Date.now() < deadline) {
    for (const id of entryIds) {
      // Fetch the real entry from the DB — indexFromExtract (called by
      // capturePathAnswers via indexPathEntries) populates emotion, distortion,
      // topic, and topic2 via applyTags, so by the time this poll loop runs the
      // DB has the fields lineageForEntry needs to find the resulting wiki pages.
      const entryRes = await getEntry(id)
      if (!entryRes.success || !entryRes.data) continue
      const res = await lineageForEntry(entryRes.data)
      if (res.success && res.data.length > 0) {
        return { id: res.data[0].id, title: res.data[0].title }
      }
    }

    // Wait for the next poll interval. If we're already past the deadline
    // (e.g. lineageForEntry calls were slow), the while condition catches it.
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  return null
}

// Once-per-session guard: the launch kick may re-run across renders, and we must
// not start two concurrent downloads of the same file.
let _onboardingDownloadStarted = false

/**
 * Kick off model download after registration, so a fresh user's models arrive
 * in the background while they complete the guided path. Fire-and-forget: never
 * awaited, never throws.
 *
 * Staged to mirror useModelDownload.download() (the Home ModelDownloadCard) but
 * without React state — the fast model unblocks journaling, then the deep model
 * downloads behind the user and triggers catch-up synthesis of any path entries
 * captured before it arrived, then the optional embed model.
 *
 * No-ops if both required models are already present (re-install with models on
 * disk) or if it has already run this session.
 */
export function beginOnboardingModelDownload(): void {
  if (_onboardingDownloadStarted) return
  _onboardingDownloadStarted = true

  void (async () => {
    if (await areModelsReady()) return

    // Phase 0: fast model — required to start journaling. Stop on failure; the
    // Home ModelDownloadCard remains as the user's retry path.
    const fastRes = await downloadModel('fast')
    if (!fastRes.success) return

    // Phase 1: deep model in the background. On success, heal any path entries
    // captured before it arrived, then fetch the optional embed model.
    const deepRes = await downloadModel('deep')
    if (!deepRes.success) return
    // Lazy require to break the pipeline ↔ first-run require cycle (Metro warns
    // a static cycle can yield uninitialized values). Resolved at call time, not
    // module load — by here both modules are fully initialized. We use require()
    // rather than dynamic import() so Jest's module registry (and the pipeline
    // mock in first-run.test.ts) still applies without --experimental-vm-modules.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { triggerCatchUp } = require('@/services/pipeline') as typeof import('@/services/pipeline')
    void triggerCatchUp()
    void downloadModel('embed')
  })()
}
