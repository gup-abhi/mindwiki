import { getEntry } from '@/services/storage/entries'
import { getSetting, setSetting } from '@/services/storage/settings'
import { getDb } from '@/services/storage/db'
import { lineageForEntry } from '@/services/wiki/engine'
import { getPage } from '@/services/storage/wiki'
import { isModelDownloaded } from '@/services/llm/model-manager'
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

// Durable receipt carrying only the first synthesized wiki page ID. Home resolves
// the current title locally when it renders the banner.
export const FIRST_RUN_PAGE_READY = 'onboarding:first_run_page_ready'
const ANNOUNCE_POLL_TIMEOUT_MS = 10_000

export interface FirstRunPageReceipt {
  id: string
}

function parseFirstRunPageReceipt(raw: string | null): FirstRunPageReceipt | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof (parsed as { id?: unknown }).id === 'string') {
      return { id: (parsed as { id: string }).id }
    }
  } catch {
    return null
  }
  return null
}

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

/**
 * Store the first synthesized wiki page as an opaque durable receipt.
 */
export async function markFirstRunPageReady(pageId: string): Promise<void> {
  await setSetting(FIRST_RUN_PAGE_READY, JSON.stringify({ id: pageId })).catch(() => undefined)
}

/** Read the pending receipt without mutating it. */
export async function peekFirstRunPageReady(): Promise<FirstRunPageReceipt | null> {
  try {
    const res = await getSetting(FIRST_RUN_PAGE_READY)
    return res.success ? parseFirstRunPageReceipt(res.data) : null
  } catch {
    return null
  }
}

/** Acknowledge the pending receipt after the user opens or dismisses it. */
export async function clearFirstRunPageReady(): Promise<void> {
  await setSetting(FIRST_RUN_PAGE_READY, '').catch(() => undefined)
}

/** Resolve a pending receipt to the current local page title. */
export async function resolveFirstRunPageReady(): Promise<{ id: string; title: string } | null> {
  const receipt = await peekFirstRunPageReady()
  if (!receipt) return null
  const page = await getPage(receipt.id)
  return page.success && page.data
    ? { id: receipt.id, title: page.data.title }
    : { id: receipt.id, title: 'Your first insight' }
}

/** Backwards-compatible read alias; unlike the old API, it never clears state. */
export const getFirstRunPageReady = resolveFirstRunPageReady

/** Announce a completed first-run page once, preserving the durable receipt. */
export async function announceFirstRunPageIfPending(): Promise<{ id: string; title: string } | null> {
  try {
    if (await peekFirstRunPageReady()) return null
    const complete = await getSetting(FIRST_RUN_FLAG)
    if (!(complete.success && complete.data === '1')) return null
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
    await markFirstRunPageReady(page.id)
    return page
  } catch {
    return null
  }
}

/** Best-effort completion announcement; safe to call from every indexing path. */
export async function announceFirstRunPageAfterIndexing(): Promise<void> {
  const page = await announceFirstRunPageIfPending()
  if (page) {
    const { sendFirstPageReadyNotification } = await import('@/services/notifications/scheduler')
    void sendFirstPageReadyNotification(page)
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
