import { type Entry, listEntriesByEmotionAllSources } from '@/services/storage/entries'
import { type Result, ok } from '@/types/result'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmotionAggregate {
  /** The canonical emotion label (Title Case). */
  emotion: string
  /** Total entries tagged with this emotion, ever. */
  totalCount: number
  /** Count in the last 4 weeks and 8 weeks, for trend signal. */
  recentCount: { last4weeks: number; last8weeks: number }
  /** The 5 most-frequent situation patterns by exact text. */
  topSituations: { pattern: string; count: number }[]
  /** Rolling average mood (1-5) in the last 4 weeks vs the prior 4 weeks,
   *  to detect whether this emotion is intensifying or easing. */
  moodTrend: {
    recentAvg: number | null
    priorAvg: number | null
    direction: 'up' | 'down' | 'stable' | 'insufficient_data'
  }
  /** 2-3 recent entries (newest, distinct situations) as concrete examples. */
  recentExamples: { situation: string; thought: string; behavior: string | null; closing_note: string | null; created_at: number }[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const TOP_SITUATIONS_LIMIT = 5
const RECENT_EXAMPLES_LIMIT = 3

// ---------------------------------------------------------------------------
// Bucketing helpers (pure, exported for testability)
// ---------------------------------------------------------------------------

/** Normalise a situation string for exact-match bucketing. */
export function bucketKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Count occurrences of each distinct situation in an entry list (exact text
 *  bucketing — "a meeting with my boss" ≠ "a meeting with my team"). */
export function countSituations(
  entries: Entry[]
): { pattern: string; count: number }[] {
  const counts = new Map<string, { pattern: string; count: number }>()
  for (const e of entries) {
    if (!e.situation.trim()) continue
    const key = bucketKey(e.situation)
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, { pattern: e.situation.trim(), count: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_SITUATIONS_LIMIT)
}

/** Compute mood trend: average mood in the last 4 weeks vs the prior 4 weeks. */
export function computeMoodTrend(
  entries: Entry[]
): EmotionAggregate['moodTrend'] {
  const now = Date.now()
  const fourWeeksAgo = now - 4 * WEEK_MS
  const eightWeeksAgo = now - 8 * WEEK_MS

  const recent: number[] = []
  const prior: number[] = []

  for (const e of entries) {
    if (e.mood == null) continue
    if (e.created_at > fourWeeksAgo) {
      recent.push(e.mood)
    } else if (e.created_at > eightWeeksAgo) {
      prior.push(e.mood)
    }
  }

  const recentAvg = recent.length > 0 ? recent.reduce((s, v) => s + v, 0) / recent.length : null
  const priorAvg = prior.length > 0 ? prior.reduce((s, v) => s + v, 0) / prior.length : null

  let direction: EmotionAggregate['moodTrend']['direction'] = 'insufficient_data'
  if (recentAvg != null && priorAvg != null) {
    if (recentAvg - priorAvg > 0.3) direction = 'up'
    else if (priorAvg - recentAvg > 0.3) direction = 'down'
    else direction = 'stable'
  } else if (recentAvg != null) {
    direction = 'stable' // only recent data means insufficient history for a trend
  }

  return { recentAvg, priorAvg, direction }
}

/** Pick the N newest entries with distinct situations (deduped by situation
 *  text) for use as concrete examples. */
export function distinctRecentExamples(
  entries: Entry[],
  limit = RECENT_EXAMPLES_LIMIT
): EmotionAggregate['recentExamples'] {
  // Entries are already newest-first from the query
  const seen = new Set<string>()
  const out: EmotionAggregate['recentExamples'] = []
  for (const e of entries) {
    if (!e.situation.trim()) continue
    const key = bucketKey(e.situation)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      situation: e.situation,
      thought: e.thought,
      behavior: e.behavior,
      closing_note: e.closing_note,
      created_at: e.created_at,
    })
    if (out.length >= limit) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build an aggregated summary of a canonical emotion's entry data, for use
 * in periodic emotion-page synthesis. Pure — the query is the only side
 * effect; the computation is deterministic from the returned entries.
 * Never throws; returns an empty aggregate on any failure so the caller
 * can fall through gracefully.
 */
export async function buildEmotionAggregate(
  emotion: string
): Promise<Result<EmotionAggregate>> {
  // The emotion page's entry_count is tickled by ALL indexed sources (journal +
  // reflect + path all route through tickleEmotionPage). The aggregate must query
  // the SAME population — journal-only would under-count and lie about trends.
  const res = await listEntriesByEmotionAllSources(emotion)
  if (!res.success) {
    // Error code only — never log entry content
    return ok(emptyAggregate(emotion))
  }

  const entries = res.data
  const now = Date.now()
  const fourWeeksAgo = now - 4 * WEEK_MS
  const eightWeeksAgo = now - 8 * WEEK_MS

  const last4weeks = entries.filter((e) => e.created_at > fourWeeksAgo).length
  const last8weeks = entries.filter((e) => e.created_at > eightWeeksAgo).length

  return ok({
    emotion,
    totalCount: entries.length,
    recentCount: { last4weeks, last8weeks },
    topSituations: countSituations(entries),
    moodTrend: computeMoodTrend(entries),
    recentExamples: distinctRecentExamples(entries),
  })
}

/** An empty aggregate for when no data is available yet. */
export function emptyAggregate(emotion: string): EmotionAggregate {
  return {
    emotion,
    totalCount: 0,
    recentCount: { last4weeks: 0, last8weeks: 0 },
    topSituations: [],
    moodTrend: { recentAvg: null, priorAvg: null, direction: 'insufficient_data' },
    recentExamples: [],
  }
}
