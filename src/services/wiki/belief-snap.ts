import { embedText } from '@/services/wiki/embeddings'
import { listEntityEmbeddings, upsertEntityEmbedding, backfillEntityEmbeddings } from '@/services/storage/entity-embeddings'
import { cosine } from '@/services/wiki/search'
import { canonicalizeBelief } from '@/services/llm/taxonomy'

// bge-small sits on a high cosine baseline (~0.3+ for unrelated text). Belief
// near-synonyms ("I am not good enough" vs "I am inadequate") score ~0.65-0.8.
// Anything at or above this threshold is snapped to the existing label.
const BELIEF_COSINE_THRESHOLD = 0.65

/**
 * Given a canonicalized belief label, look through stored belief embeddings for
 * a near-semantic match. If one exists at or above the threshold, return the
 * existing label (so it accumulates instead of fragmenting). If no match, store
 * the new label's vector for future comparisons. Best-effort — on any failure
 * (embed model unavailable, DB error) returns the input unchanged so the
 * pipeline never stalls.
 */
export async function snapBeliefSemantic(label: string): Promise<string> {
  try {
    const stored = await listEntityEmbeddings('belief')
    if (!stored.success || stored.data.size === 0) {
      // No existing embeddings to compare against — store this one for future
      // (best-effort, fire-and-forget).
      void embedThenStore(label)
      return label
    }

    const vec = await embedText(label)
    if (!vec.success) return label

    let bestLabel = label
    let bestScore = BELIEF_COSINE_THRESHOLD
    for (const [existing, emb] of stored.data) {
      const sim = cosine(vec.data, emb.vector)
      if (sim >= bestScore) {
        bestScore = sim
        bestLabel = existing
      }
    }

    // If we didn't snap to anything existing, store the new vector so future
    // entries can snap to this label.
    if (bestLabel === label) {
      void upsertEntityEmbedding(label, 'belief', vec.data)
    }

    return bestLabel
  } catch {
    return label
  }
}

/**
 * Snap a list of canonicalized belief labels: each one is semantically matched
 * against stored beliefs, consolidating near-synonyms. Best-effort; on any
 * failure returns the input list unchanged.
 */
export async function snapBeliefsSemantic(labels: string[]): Promise<string[]> {
  if (labels.length === 0) return labels
  try {
    const deduped = new Map<string, string>()
    for (const l of labels) {
      const snapped = await snapBeliefSemantic(l)
      deduped.set(snapped.toLowerCase(), snapped)
    }
    return [...deduped.values()].slice(0, 2)
  } catch {
    return labels
  }
}

/**
 * Backfill belief embeddings for all existing belief labels. Best-effort;
 * call once at startup (alongside the page-embedding backfill).
 */
export async function backfillBeliefEmbeddings(): Promise<number> {
  return backfillEntityEmbeddings('belief', embedText)
}

/**
 * Embed a single label and store its vector. Fire-and-forget helper — never
 * throws; a failure is simply swallowed.
 */
async function embedThenStore(label: string): Promise<void> {
  try {
    const vec = await embedText(label)
    if (vec.success) await upsertEntityEmbedding(label, 'belief', vec.data)
  } catch {
    // best-effort
  }
}
