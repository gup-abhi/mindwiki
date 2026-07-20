import { canonicalizeBelief } from '@/services/llm/taxonomy'
import { listDistinctBeliefLabels } from '@/services/storage/entities'
import { listEntityEmbeddings } from '@/services/storage/entity-embeddings'
import { cosine } from '@/services/wiki/search'
import {
  BELIEF_COSINE_THRESHOLD,
  isPolarityCollision,
  embedBeliefLabel,
} from '@/services/wiki/belief-match'

export interface ExistingBeliefMatch {
  /** The matching existing belief label, or null if no match. */
  belief: string | null
  /** How the match was found: exact (canonical text match), semantic (embedding), or none. */
  matchType: 'exact' | 'semantic' | 'none'
}

/**
 * Read-only matcher: given a thought, check whether it maps to an EXISTING
 * recurring belief. Returns the matched label and the match type, or null/none.
 * Unlike snapBeliefSemantic, this NEVER upserts an embedding, writes an entity,
 * or has any side effect — it is safe to call from the untangle flow without
 * polluting the knowledge base.
 *
 * Strategy: exact canonical label match first (fast, no model needed), then
 * semantic embedding match using the same frame-stripped geometry, polarity
 * guard, and 0.78 cosine threshold as snapBeliefSemantic.
 */
export async function findExistingBeliefMatch(thought: string): Promise<ExistingBeliefMatch> {
  try {
    const can = canonicalizeBelief(thought)
    if (!can) return { belief: null, matchType: 'none' }

    // 1. Exact canonical-text match against stored belief labels (no model call).
    const labelRes = await listDistinctBeliefLabels()
    if (!labelRes.success) return { belief: null, matchType: 'none' }
    for (const label of labelRes.data) {
      if (can.toLowerCase() === label.toLowerCase()) {
        return { belief: label, matchType: 'exact' }
      }
    }

    // 2. Semantic match against stored belief embeddings.
    return matchSemantic(can)
  } catch {
    return { belief: null, matchType: 'none' }
  }
}

async function matchSemantic(canonical: string): Promise<ExistingBeliefMatch> {
  const stored = await listEntityEmbeddings('belief')
  if (!stored.success || stored.data.size === 0) {
    return { belief: null, matchType: 'none' }
  }

  const vec = await embedBeliefLabel(canonical)
  if (!vec.success) return { belief: null, matchType: 'none' }

  let bestLabel: string | null = null
  let bestScore = BELIEF_COSINE_THRESHOLD
  for (const [existing, emb] of stored.data) {
    if (isPolarityCollision(existing, canonical)) continue
    const sim = cosine(vec.data, emb.vector)
    if (sim >= bestScore) {
      bestScore = sim
      bestLabel = existing
    }
  }

  return bestLabel
    ? { belief: bestLabel, matchType: 'semantic' }
    : { belief: null, matchType: 'none' }
}
