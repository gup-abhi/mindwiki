import { listEntityEmbeddings, upsertEntityEmbedding, backfillEntityEmbeddings } from '@/services/storage/entity-embeddings'
import { cosine } from '@/services/wiki/search'
import {
  BELIEF_COSINE_THRESHOLD,
  isPolarityCollision,
  embedBeliefLabel,
} from './belief-match'

/** F-02A — single-flight chain so belief-snap operations serialize through one
 *  in-process critical section. Two concurrent near-synonym first sightings now
 *  queue: the second observes the first's stored vector and snaps, instead of
 *  both embedding+upserting their own (avoidable fragmentation). The chain never
 *  propagates a rejection — one failure can't starve later snaps. */
let snapChain: Promise<unknown> = Promise.resolve()
function runSerial<T>(task: () => Promise<T>): Promise<T> {
  const ran = snapChain.then(task, task)
  // Swallow the terminal rejection so the next queued op still runs.
  snapChain = ran.then(
    () => undefined,
    () => undefined
  )
  return ran
}

/**
 * Given a canonicalized belief label, look through stored belief embeddings for
 * a near-semantic match. If one exists at or above the threshold, return the
 * existing label (so it accumulates instead of fragmenting). If no match, store
 * the new label's vector for future comparisons. Serialized — a second
 * near-synonym sighting awaits the first's upsert before reading the store, so
 * two new labels in the same cluster converge on one anchor instead of both
 * creating fragmented aliases. Best-effort — on any failure (embed model
 * unavailable, DB error) returns the input unchanged so the pipeline never
 * stalls.
 */
export async function snapBeliefSemantic(label: string): Promise<string> {
  return runSerial(() => snapBeliefSemanticCritical(label))
}

async function snapBeliefSemanticCritical(label: string): Promise<string> {
  try {
    const stored = await listEntityEmbeddings('belief')
    if (!stored.success || stored.data.size === 0) {
      // No existing embeddings to compare against — embed + store synchronously
      // (awaited, not fire-and-forget) so a queued second sighting observes it.
      await embedThenStore(label)
      return label
    }

    const vec = await embedBeliefLabel(label)
    if (!vec.success) return label

    let bestLabel = label
    let bestScore = BELIEF_COSINE_THRESHOLD
    for (const [existing, emb] of stored.data) {
      if (isPolarityCollision(existing, label)) continue
      const sim = cosine(vec.data, emb.vector)
      if (sim >= bestScore) {
        bestScore = sim
        bestLabel = existing
      }
    }

    // If we didn't snap to anything existing, store the new vector — awaited,
    // so the queue guarantees the next sighting sees it — for future entries
    // to snap to this label.
    if (bestLabel === label) {
      await upsertEntityEmbedding(label, 'belief', vec.data)
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
 * call once at startup (alongside the page-embedding backfill). Returns a
 * count-only {embedded, failed} so a partial pass (some labels fail to embed)
 * still reports what finished without leaking label text.
 */
export async function backfillBeliefEmbeddings(): Promise<{ embedded: number; failed: number }> {
  return backfillEntityEmbeddings('belief', embedBeliefLabel)
}

/**
 * Embed a single label and store its vector. Awaited inside the snap critical
 * section so a queued second sighting observes the write; never throws — a
 * failure is simply swallowed and the caller keeps the input label.
 */
async function embedThenStore(label: string): Promise<void> {
  try {
    const vec = await embedBeliefLabel(label)
    if (vec.success) await upsertEntityEmbedding(label, 'belief', vec.data)
  } catch {
    // best-effort
  }
}
