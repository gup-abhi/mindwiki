// Lookup API over the static therapy reference KB. Two consumers:
//  - conversation (distortionGuide): no per-message tag exists, so the model
//    must identify from in-context examples — we give it a terse guide.
//  - synthesis (synthesisHint): the entry already carries its distortion tag, so
//    we ground the page in ONE natural-language instruction (NOT a labelled data
//    block — the small model parrots those verbatim into the page, which leaked
//    the scaffolding to the reader). synthesizePage also guards its output.

import { canonicalizeDistortion } from '../taxonomy'
import { DISTORTION_REFERENCE } from './distortions'

export { REFLECTIVE_TECHNIQUES, FEW_SHOT } from './techniques'
export { DISTORTION_REFERENCE } from './distortions'
export { EMOTION_REFERENCE } from './emotions'
export type { DistortionEntry } from './distortions'

// The conversation prompt shares the deep model's 2048-token context with the
// wiki pages, history, and rolling summary, so the guide is trimmed to the most
// common distortions (taxonomy order) rather than all 14. Raise/lower in one
// edit if device testing shows headroom or pressure.
const MAX_GUIDE_DISTORTIONS = 8

/**
 * One natural-language grounding line for wiki synthesis, derived from the
 * entry's distortion tag. Deliberately label-free and definition-free: it reads
 * as an instruction among the other instructions, so the small model is far less
 * likely to copy it into the page (and synthesizePage rejects any output that
 * still echoes scaffolding). Returns '' when there's no distortion.
 */
export function synthesisHint(distortion?: string | null): string {
  const canon = distortion ? canonicalizeDistortion(distortion) : 'none'
  if (canon === 'none') return ''
  const entry = DISTORTION_REFERENCE[canon]
  if (!entry) return ''
  return `The writer tends toward ${entry.name.toLowerCase()} here; where it genuinely fits, gently reflect the more balanced perspective in your own plain words.`
}

/**
 * Terse one-line-per-distortion guide with an identification example each, for
 * the conversation system prompt. The examples are what let the model spot a
 * distortion in the live message. Built once at module load.
 */
export const distortionGuide: () => string = (() => {
  const lines = Object.values(DISTORTION_REFERENCE)
    .slice(0, MAX_GUIDE_DISTORTIONS)
    .map((d) => `- ${d.name}: ${d.definition} — e.g. "${d.examples[0]}"`)
  const guide = ['Common distorted-thinking patterns to listen for:', ...lines].join('\n')
  return () => guide
})()
