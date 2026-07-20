import { embedText } from '@/services/wiki/embeddings'
import { type Result } from '@/types/result'

// The threshold and frame/polarity rules for belief matching live HERE as the
// single source of truth. snapBeliefSemantic (write path) and the read-only
// untangle matcher both consume these so they cannot drift apart.

// On device the true synonym scores 0.841 and a frame-sharing distinct belief
// 0.709 against the anchor "I am not good enough", so 0.78 snaps the synonym
// while the distinct belief stays its own page.
export const BELIEF_COSINE_THRESHOLD = 0.78

// STS prefix over-weights the shared "I am [not] ..." frame on short fragments,
// so a frame-sharing DISTINCT belief out-scores a true synonym — an inverted
// window no threshold separates (device-measured). Strip the leading frame
// before embedding so content words carry the vector. We strip for the VECTOR
// only; the full label stays the stored identity.
const BELIEF_FRAME = /^i\s+(?:am|feel|'m)\s+(?:not\s+|never\s+)?/i

const BELIEF_FRAME_NEGATED = /^i\s+(?:am|feel|'m)\s+(?:not|never)\s+/i

/** Drop the leading "I am/feel/'m [not/never]" frame so content words carry the vector. */
export function stripBeliefFrame(label: string): string {
  return label.replace(BELIEF_FRAME, '').trim()
}

/** True if the belief's leading frame is negated ("I am not/never …"). */
export function isNegatedBelief(label: string): boolean {
  return BELIEF_FRAME_NEGATED.test(label)
}

/** Whether two labels would collide only via the polarity guard (same stripped text, opposite negation). */
export function isPolarityCollision(existing: string, candidate: string): boolean {
  return (
    isNegatedBelief(existing) !== isNegatedBelief(candidate) &&
    stripBeliefFrame(existing).toLowerCase() === stripBeliefFrame(candidate).toLowerCase()
  )
}

/** Embed a belief label in the frame-stripped space used for snapping. */
export function embedBeliefLabel(label: string): Promise<Result<number[]>> {
  return embedText(stripBeliefFrame(label))
}

