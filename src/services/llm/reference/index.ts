// Lookup API over the static therapy reference KB. Two consumers:
//  - synthesis (decodeFor): the entry already carries ONE distortion + ONE
//    emotion tag, so we inject just those, compact.
//  - conversation (distortionGuide): no per-message tag exists, so the model
//    must identify from in-context examples — we give it a terse guide.
// Everything is capped to protect the deep model's 2048-token context budget.

import { canonicalizeDistortion } from '../taxonomy'
import { DISTORTION_REFERENCE } from './distortions'
import { EMOTION_REFERENCE } from './emotions'

export { REFLECTIVE_TECHNIQUES, FEW_SHOT } from './techniques'
export { DISTORTION_REFERENCE } from './distortions'
export { EMOTION_REFERENCE } from './emotions'
export type { DistortionEntry } from './distortions'

const MAX_DECODE_CHARS = 400
// The conversation prompt shares the deep model's 2048-token context with the
// wiki pages, history, and rolling summary, so the guide is trimmed to the most
// common distortions (taxonomy order) rather than all 14. Raise/lower in one
// edit if device testing shows headroom or pressure.
const MAX_GUIDE_DISTORTIONS = 8

export interface DecodeInput {
  /** Canonical distortion tag for the entry (or 'none'/undefined). */
  distortion?: string | null
  /** Canonical emotion tag for the entry (optional). */
  emotion?: string | null
}

/**
 * Compact decode for an entry's tags — the matched distortion's reframe lens
 * plus the emotion's cue. Returns '' when there's no distortion to decode (the
 * common case), so callers inject nothing. Char-capped.
 */
export function decodeFor({ distortion, emotion }: DecodeInput): string {
  const canon = distortion ? canonicalizeDistortion(distortion) : 'none'
  const entry = canon !== 'none' ? DISTORTION_REFERENCE[canon] : undefined
  if (!entry) return '' // no distortion to decode — the common case; inject nothing

  const lines = [
    `Thinking pattern: ${entry.name} — ${entry.definition}.`,
    `Reframe lens: ${entry.reframe}`,
  ]
  if (emotion) {
    const cue = EMOTION_REFERENCE[emotion]
    if (cue) lines.push(`Feeling: ${emotion} — ${cue}.`)
  }
  return lines.join('\n').slice(0, MAX_DECODE_CHARS)
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
