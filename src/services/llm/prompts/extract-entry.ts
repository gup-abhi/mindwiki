import { EMOTIONS, DISTORTIONS } from '../taxonomy'
import { distortionGuide } from '../reference'

export interface ExtractPromptInput {
  situation: string
  thought: string
  behavior?: string | null
  closing_note?: string | null
}

/**
 * Deep-model instruction: extract everything that feeds the knowledge base —
 * emotion, distortion (+confidence, grounded in the KB's example-led guide),
 * mood, a stable concrete topic, and concrete entities. The deep model is much
 * more consistent than the fast tagger at topic/entity extraction, which the
 * recurrence-gated graph depends on. Output is a single JSON object. On-device.
 */
export function buildExtractPrompt({ situation, thought, behavior, closing_note }: ExtractPromptInput): string {
  const lines = [
    'You analyze a journal entry and output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"emotion": string, "distortion": string, "distortion_confidence": number, "mood_score": number, "topic": string, "people": string[], "places": string[], "activities": string[], "beliefs": string[], "behaviors": string[]}',
    `- emotion: the single closest from this list ONLY: ${EMOTIONS.join(', ')}.`,
    `- distortion: the single closest from this list ONLY, or "none" if the thinking is`,
    `  not actually distorted: ${DISTORTIONS.join(', ')}.`,
    '- distortion_confidence: 0.0 to 1.0 — how sure you are the named distortion is truly',
    '  present. Use a LOW value (or "none") rather than forcing one that is not clearly there.',
    '- mood_score: 0.0 (very negative) to 1.0 (very positive).',
    '- topic: a short, CONCRETE 1-3 word theme naming what the entry is really about',
    '  (e.g. "App", "Job hunting", "Sister"). Be consistent — the SAME subject across',
    '  entries must get the SAME topic, so it accumulates rather than fragmenting.',
    '- people: specific named people (e.g. "Sarah", "Manager"). Never the writer. [] if none.',
    '- places: specific places (e.g. "Office", "Gym"). [] if none.',
    '- activities: concrete things the writer is doing, building, or using — projects, apps,',
    '  habits, events (e.g. "App", "Marathon training", "Standup"). [] if none.',
    'For people/places/activities: concrete nouns only, at most 3 each, short labels, no sentences.',
    '- beliefs: the underlying core belief the entry reveals about the writer or their world',
    '  (e.g. "I am not good enough", "I have to be perfect", "People will leave"). Phrase it as a',
    '  SHORT, GENERAL, reusable statement — NOT this specific situation — so the SAME belief',
    '  recurs across entries. At most 2. [] if none is clearly expressed.',
    '- behaviors: a recurring way the writer RESPONDS, named as a short general pattern',
    '  (e.g. "Avoidance", "Overworking", "Withdrawing", "People-pleasing"). 1-2 words. At most 2.',
    '  [] if no clear behavioral response.',
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
