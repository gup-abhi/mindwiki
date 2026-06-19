import { EMOTIONS, DISTORTIONS } from '../taxonomy'
import { distortionGuide } from '../reference'

export interface AffectPromptInput {
  situation: string
  thought: string
  behavior?: string | null
  closing_note?: string | null
}

/**
 * Deep-model prompt to re-classify an entry's emotion + cognitive distortion.
 * Unlike the fast tagger, the deep model gets the KB's example-led distortion
 * guide so it can actually RECOGNIZE the pattern, and is asked for a confidence
 * on the distortion call (the caller drops low-confidence ones to 'none').
 * Output is a single JSON object. Runs on-device only.
 */
export function buildAffectPrompt({ situation, thought, behavior, closing_note }: AffectPromptInput): string {
  const lines = [
    'You classify the emotion and cognitive distortion in a journal entry.',
    'Output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"emotion": string, "distortion": string, "distortion_confidence": number}',
    `- emotion: the single closest from this list ONLY: ${EMOTIONS.join(', ')}.`,
    `- distortion: the single closest from this list ONLY, or "none" if the thinking is`,
    `  not actually distorted: ${DISTORTIONS.join(', ')}.`,
    '- distortion_confidence: 0.0 to 1.0 — how sure you are the named distortion is truly',
    '  present. Use a LOW value when unsure or when the thought is reasonable; use "none"',
    '  with low confidence rather than forcing a distortion that is not clearly there.',
    '',
    distortionGuide(),
    '',
    `Situation: ${situation}`,
    `Thought: ${thought}`,
  ]
  if (behavior && behavior.trim()) lines.push(`Behavior: ${behavior}`)
  if (closing_note && closing_note.trim()) lines.push(`Closing note: ${closing_note}`)
  lines.push('', 'JSON:')
  return lines.join('\n')
}
