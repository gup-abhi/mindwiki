import { getEntry } from '@/services/storage/entries'
import { getSetting, setSetting } from '@/services/storage/settings'
import { getDb } from '@/services/storage/db'
import { lineageForEntry } from '@/services/wiki/engine'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { hasSeenOnboarding } from '@/services/onboarding/seen'

// Settings keys (persisted across sessions, never synced).
const FIRST_RUN_FLAG = 'onboarding:first_run_complete'
const FIRST_RUN_ENTRY_IDS = 'onboarding:first_run_entry_ids'

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
  /** Whether the deep model is already downloaded — affects post-path poll timeout. */
  deepReady: boolean
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
 * Check the first-run status after the carousel is dismissed. Returns whether
 * a first-run path should run, which path to use, and whether the deep model
 * is ready (drives the post-path polling timeout).
 *
 * Skips the first run if:
 *  - The completion flag is set, OR
 *  - The onboarding carousel was never shown (possible on re-install where
 *    SecureStore/Keychain data carried over), because the carousel is the
 *    user's introduction to the product and must precede the guided path, OR
 *  - Entries already exist (existing account on a new device).
 *
 * Best-effort: a storage failure returns `{ shouldRun: true }` — safer to
 * re-run the path than to skip it and leave the user in a cold start.
 */
export async function firstRunStatus(): Promise<FirstRunStatus> {
  const flag = await getSetting(FIRST_RUN_FLAG)
  if (flag.success && flag.data === '1') {
    return { shouldRun: false, pathId: FIRST_RUN_PATH_ID, deepReady: await isModelDownloaded('deep') }
  }

  // If the onboarding carousel was never shown (Keychain survived an install
  // wipe), don't skip straight to the guided path — the carousel introduces
  // the product. The AppGate renders it before AppRoot in the same session,
  // but this is a cross-session safety net.
  if (!(await hasSeenOnboarding())) {
    return { shouldRun: false, pathId: FIRST_RUN_PATH_ID, deepReady: await isModelDownloaded('deep') }
  }

  // Existing entries mean this is an existing user, not a fresh install.
  if (await hasExistingEntries()) {
    await setSetting(FIRST_RUN_FLAG, '1').catch(() => undefined)
    return { shouldRun: false, pathId: FIRST_RUN_PATH_ID, deepReady: await isModelDownloaded('deep') }
  }

  return {
    shouldRun: true,
    pathId: FIRST_RUN_PATH_ID,
    deepReady: await isModelDownloaded('deep'),
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
