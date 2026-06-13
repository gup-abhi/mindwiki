import { EMOTIONS, DISTORTIONS } from '../taxonomy'

export interface TagPromptInput {
  situation: string
  thought: string
  behavior?: string | null
  closing_note?: string | null
}

/**
 * Instruction for the fast model to tag an entry. Output is constrained to a
 * single JSON object matching EntryTagSchema. emotion + distortion must come
 * from the controlled vocabulary (also enforced in code via taxonomy.ts). Runs
 * on-device only.
 */
export function buildTagPrompt({ situation, thought, behavior, closing_note }: TagPromptInput): string {
  const lines = [
    'You analyze a journal entry and output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"emotion": string, "distortion": string, "mood_score": number, "crisis_confidence": number, "topic": string, "people": string[], "places": string[], "activities": string[], "working_on": string, "pursuit_status": "active"|"done"|"abandoned"}',
    `- emotion: choose the single closest from this list ONLY: ${EMOTIONS.join(', ')}.`,
    `- distortion: choose the single closest from this list ONLY, or "none": ${DISTORTIONS.join(', ')}.`,
    '- mood_score: 0.0 (very negative) to 1.0 (very positive).',
    '- crisis_confidence: 0.0 to 1.0 — likelihood the writer is in crisis or at risk of self-harm.',
    '- topic: a short 1-3 word theme for this entry (e.g. "Work", "Public speaking", "Family").',
    '- people: specific people mentioned, as short labels (e.g. "Sarah", "Manager"). Never include the writer (I/me/myself). [] if none.',
    '- places: specific places mentioned, as short labels (e.g. "Office", "Home", "Gym"). [] if none.',
    '- activities: specific activities or events mentioned, as short labels (e.g. "Standup", "Therapy", "Running"). [] if none.',
    'For people/places/activities: concrete nouns only, at most 3 each, no duplicates, no full sentences.',
    '- working_on: a short phrase (2-5 words) naming something the writer is actively working on or pursuing — an ongoing goal, project, or effort (e.g. "Marathon training", "Job hunting", "Fixing my sleep"). "" if the entry names no such thing.',
    '- pursuit_status: "done" if the entry says working_on was just finished or achieved; "abandoned" if the writer gave it up or stopped; otherwise "active". Use "active" when working_on is "".',
    '',
    `Situation: ${situation}`,
    `Thought: ${thought}`,
  ]
  if (behavior && behavior.trim()) lines.push(`Behavior: ${behavior}`)
  if (closing_note && closing_note.trim()) lines.push(`Closing note: ${closing_note}`)
  lines.push('', 'JSON:')
  return lines.join('\n')
}
