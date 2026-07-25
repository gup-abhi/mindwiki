// F-01 Slice 6 — all-source stratified evidence selection for re-grounding.
//
// Two responsibilities:
//
//   1. listAllSourceEntriesForPage(title, category, db?) — routes by page
//      category to the source-INCLUSIVE storage query (journal + reflect +
//      path). Re-grounding samples across all eligible sources, not just the
//      'journal' column. Emotion is aggregate-owned and handled separately,
//      so this router excludes it by contract (emotion callers skip via the
//      engine trigger, not here).
//
//   2. selectReGroundEvidence(corpus, { max, excludeIds? }) — deterministic
//      bounded stratified selector over the complete ordered result:
//        - newest evidence
//        - oldest evidence
//        - evenly-spaced middle evidence
//        - at most `max` total (default 6)
//        - no duplicate IDs
//      Output is ascending by created_at (oldest first). This matches the
//      "oldest → middle → newest" probe order the re-ground prompter expects,
//      and guarantees a small-N corpus (≤ max) returns the full set unchanged
//      by sampling.
//
// Pure functions only; no DB writes. No source-text logging. The selector
// deserialises through Entry.id for dedupe (entries are uniquely keyed).

import type { Entry } from '@/services/storage/entries'
import type { Result } from '@/types/result'
import {
  listEntriesByEmotionAllSources,
  listEntriesByDistortionAllSources,
  listEntriesByTopicOrTopic2,
  listEntriesForEntityAllSources,
} from '@/services/storage/entries'
import type { SqliteDatabase } from '@/services/storage/db'
import type { EntityType } from '@/services/storage/entities'

/** Wiki page categories that route to entity-tag storage. */
const ENTITY_CATEGORIES = ['person', 'place', 'activity', 'belief', 'behavior'] as const

/** Page category → all-source entries list. */
export async function listAllSourceEntriesForPage(
  title: string,
  category: string,
  db?: SqliteDatabase
): Promise<Result<Entry[]>> {
  // Returns a Result; on routing miss returns ok([]); on query failure returns
  // ok([]) too — callers treat the empty list as "best-effort fallback to
  // normal incremental synthesis" rather than a hard error (per plan point 6:
  // "one source query fails" is an edge case the engine tolerates).
  try {
    if (category === 'emotion') {
      const r = await listEntriesByEmotionAllSources(title, db)
      return r.success ? r : okEmpty()
    }
    if (category === 'distortion') {
      const r = await listEntriesByDistortionAllSources(title, db)
      return r.success ? r : okEmpty()
    }
    if (category === 'theme') {
      // includeAllSources = false → journal+reflect+path (the wrapper's default
      // source-inclusive pref)
      const r = await listEntriesByTopicOrTopic2(title, db, false)
      return r.success ? r : okEmpty()
    }
    if (isEntityCategory(category)) {
      const r = await listEntriesForEntityAllSources(category, title, db)
      return r.success ? r : okEmpty()
    }
    return okEmpty()
  } catch {
    return okEmpty()
  }
}

function isEntityCategory(category: string): category is EntityType {
  return (ENTITY_CATEGORIES as readonly string[]).includes(category)
}

function okEmpty(): Result<Entry[]> {
  return { success: true, data: [] }
}

export interface ReGroundEvidenceOptions {
  /** Maximum number of evidence entries to return. Default 6. */
  max?: number
  /** IDs to exclude (e.g. the current entry being processed now). */
  excludeIds?: Set<string>
}

/**
 * Deterministic stratified bounded selector for re-grounding evidence.
 *
 * Algorithm:
 *   1. dedupe by id, drop excluded ids, drop null
 *   2. sort ascending by created_at (tiebreak by id for determinism)
 *   3. if count ≤ max → return all (oldest first)
 *   4. else: pick oldest, newest, and (max-2) entries evenly spaced through
 *      the middle (the exclusive-interior indices), preserving oldest-first
 *      ordering. Even spacing uses the standard linspace over the interior's
 *      index range.
 *
 * The "max-2 middle" anchors cover the oldest and newest entries plus a
 * representative spread of the middle period; no entry appears more than once.
 */
export function selectReGroundEvidence(
  corpus: Entry[],
  options: ReGroundEvidenceOptions = {}
): Entry[] {
  const max = options.max ?? 6
  const exclude = options.excludeIds

  // Dedupe → ordered list of unique entries sorted ascending by created_at,
  // then by id for a stable deterministic tiebreak.
  const seen = new Set<string>()
  const unique: Entry[] = []
  for (const e of corpus) {
    if (!e || exclude?.has(e.id)) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    unique.push(e)
  }
  if (unique.length === 0) return []
  unique.sort((a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  if (unique.length <= max) return unique

  // We want `max` entries: positions 0 (oldest), len-1 (newest), and max-2
  // evenly spaced interior points. Compute interior indices (1 .. len-2),
  // then evenly pick max-2 of them.
  const interiorCount = max - 2
  const interiorLen = unique.length - 2 // count of indices strictly between 0 and len-1
  const pickedIdx = new Set<number>([0, unique.length - 1])
  for (let k = 0; k < interiorCount; k++) {
    // Even spacing: index = round((k + 1) * (interiorLen / (interiorCount + 1)))
    // gives the (k+1)-th quantile of the interior — biased toward a uniform
    // gap between consecutive picks including endpoints.
    const interiorIdx = Math.round(((k + 1) * interiorLen) / (interiorCount + 1))
    pickedIdx.add(1 + interiorIdx)
  }
  const indices = Array.from(pickedIdx).sort((a, b) => a - b)
  const out: Entry[] = []
  for (const i of indices) {
    if (i >= 0 && i < unique.length && !out.some((e) => e.id === unique[i].id)) {
      out.push(unique[i])
    }
  }
  return out
}
