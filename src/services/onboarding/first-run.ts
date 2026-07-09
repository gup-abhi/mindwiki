import { getSetting, setSetting } from '@/services/storage/settings'
import { lineageForEntry } from '@/services/wiki/engine'
import { isModelDownloaded } from '@/services/llm/model-manager'

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
 * Check the first-run status after the carousel is dismissed. Returns whether
 * a first-run path should run, which path to use, and whether the deep model
 * is ready (drives the post-path polling timeout).
 *
 * Best-effort: a storage failure returns `{ shouldRun: true }` — safer to
 * re-run the path than to skip it and leave the user in a cold start.
 */
export async function firstRunStatus(): Promise<FirstRunStatus> {
  const flag = await getSetting(FIRST_RUN_FLAG)
  const completed = flag.success && flag.data === '1'

  return {
    shouldRun: !completed,
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
      const res = await lineageForEntry({
        id,
        created_at: 0,
        mood: 3,
        situation: '',
        thought: '',
        behavior: null,
        closing_note: null,
        emotion: null,
        named_emotion: null,
        energy: null,
        distortion: null,
        mood_score: null,
        topic: null,
        topic2: null,
        tagged_at: null,
        wiki_indexed_at: null,
        graph_indexed_at: null,
        raw_text: null,
        source: 'path',
      } as any)
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
