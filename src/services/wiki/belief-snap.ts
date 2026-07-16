import { type Result } from '@/types/result'
import { embedText } from '@/services/wiki/embeddings'
import { listEntityEmbeddings, upsertEntityEmbedding, backfillEntityEmbeddings } from '@/services/storage/entity-embeddings'
import { cosine } from '@/services/wiki/search'
import { canonicalizeBelief } from '@/services/llm/taxonomy'

// Threshold sits in the window opened by frame-stripping (see stripBeliefFrame):
// on device the true synonym scores 0.841 and a frame-sharing distinct belief 0.709
// against the anchor "I am not good enough", so 0.78 snaps the synonym while the
// distinct belief stays its own page. (Raw, un-stripped, the distinct belief 0.848
// out-scored the synonym 0.772 — an inverted window no threshold could separate.)
const BELIEF_COSINE_THRESHOLD = 0.78

// EmbeddingGemma + the STS prefix over-weights the shared "I am [not] …" frame on
// short belief fragments, so a frame-sharing but DISTINCT belief out-scores a true
// synonym against the anchor — an inverted window no threshold separates (device-
// measured). Stripping the leading first-person frame before embedding lets the
// content words dominate and opens a separable window. We strip for the VECTOR only;
// the full label stays the stored identity and what snapBeliefSemantic returns.
const BELIEF_FRAME = /^i\s+(?:am|feel|'m)\s+(?:not\s+|never\s+)?/i

/** Drop the leading "I am/feel/'m [not/never]" frame so content words carry the vector. */
function stripBeliefFrame(label: string): string {
  return label.replace(BELIEF_FRAME, '').trim()
}

// stripBeliefFrame removes not/never along with the subject, so a belief
// ("I am not good enough" → "good enough") and its positive reframe
// ("I am good enough" → "good enough") collapse to IDENTICAL text (cosine 1.000,
// device-confirmed). MindWiki's reframe feature creates those positive counter-
// beliefs, so the snap loop refuses to merge two beliefs whose stripped forms are
// identical but whose polarity differs. The guard is narrow on purpose: negative
// beliefs phrased without "not" ("I feel worthless") must still snap to negative
// synonyms that do have it ("I am not good enough"). isNegatedBelief only flags
// whether the stripped frame itself carried a negation.
const BELIEF_FRAME_NEGATED = /^i\s+(?:am|feel|'m)\s+(?:not|never)\s+/i

/** True if the belief's leading frame is negated ("I am not/never …"). */
function isNegatedBelief(label: string): boolean {
  return BELIEF_FRAME_NEGATED.test(label)
}

/** Embed a belief label in the frame-stripped space used for snapping. */
function embedBeliefLabel(label: string): Promise<Result<number[]>> {
  return embedText(stripBeliefFrame(label))
}

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

    const vec = await embedBeliefLabel(label)
    if (!vec.success) return label

    const labelStripped = stripBeliefFrame(label).toLowerCase()
    const labelNegated = isNegatedBelief(label)
    let bestLabel = label
    let bestScore = BELIEF_COSINE_THRESHOLD
    for (const [existing, emb] of stored.data) {
      // Guard the reframe collision: if two beliefs strip to the same text but
      // differ in polarity ("I am not good enough" vs "I am good enough" → both
      // "good enough"), their vectors are identical (cosine 1.000) yet they're
      // opposite beliefs — never merge them.
      if (
        isNegatedBelief(existing) !== labelNegated &&
        stripBeliefFrame(existing).toLowerCase() === labelStripped
      ) {
        continue
      }
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
 *
 * Embeds via embedBeliefLabel (frame-stripped), NOT embedText — the stored
 * vectors must live in the same stripped geometry the snap query builds, or
 * the cosine comparison mixes stripped-vs-raw vectors and the full-strip
 * window collapses. migration027 wipes the pre-strip belief rows so this
 * repopulates them under the stripped geometry.
 */
export async function backfillBeliefEmbeddings(): Promise<number> {
  return backfillEntityEmbeddings('belief', embedBeliefLabel)
}

/**
 * Embed a single label and store its vector. Fire-and-forget helper — never
 * throws; a failure is simply swallowed.
 */
async function embedThenStore(label: string): Promise<void> {
  try {
    const vec = await embedBeliefLabel(label)
    if (vec.success) await upsertEntityEmbedding(label, 'belief', vec.data)
  } catch {
    // best-effort
  }
}
