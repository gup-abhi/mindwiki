import { EMOTIONS, DISTORTIONS } from '../taxonomy'
import { distortionGuide } from '../reference'

export interface ExtractPromptInput {
  situation: string
  thought: string
  behavior?: string | null
  closing_note?: string | null
}

export interface ExtractOptions {
  /** Also ask for `restatement` — a self-contained rewrite of the message.
   *  Reflect-only: chat fragments depend on conversation context, while a
   *  journal entry already stands alone (and its extract stays cheaper). */
  restate?: boolean
  /** Recent conversation turns (pre-truncated), so the restatement can resolve
   *  "it/that/this" in a chat fragment. Reference only — never analyzed. */
  context?: string | null
}

/**
 * Deep-model instruction: extract everything that feeds the knowledge base —
 * emotion, distortion (+confidence, grounded in the KB's example-led guide),
 * mood, a stable concrete topic, and concrete entities. The deep model is much
 * more consistent than the fast tagger at topic/entity extraction, which the
 * recurrence-gated graph depends on. Output is a single JSON object. On-device.
 */
export function buildExtractPrompt(
  { situation, thought, behavior, closing_note }: ExtractPromptInput,
  { restate = false, context }: ExtractOptions = {}
): string {
  const restateField = restate ? ', "restatement": string' : ''
  const lines = [
    'You analyze a journal entry and output ONLY a JSON object — no prose, no markdown.',
    `Schema: {"emotion": string, "distortion": string, "distortion_confidence": number, "mood_score": number, "topics": string[], "people": string[], "places": string[], "activities": string[], "beliefs": string[], "behaviors": string[]${restateField}}`,
    `- emotion: the single closest from this list ONLY: ${EMOTIONS.join(', ')}.`,
    `- distortion: the single closest from this list ONLY, or "none" if the thinking is`,
    `  not actually distorted: ${DISTORTIONS.join(', ')}.`,
    '- distortion_confidence: 0.0 to 1.0 — how sure you are the named distortion is truly',
    '  present. Use a LOW value (or "none") rather than forcing one that is not clearly there.',
    '- mood_score: 0.0 (very negative) to 1.0 (very positive).',
    '- topics: 1-2 short, CONCRETE themes naming what the entry is really about',
    '  (e.g. "App", "Job hunting", "Marriage"). Be consistent — the SAME subject across',
    '  entries must get the SAME topic (same singular form) so it accumulates rather',
    '  than fragmenting. Two topics when the entry crosses between domains (e.g.',
    '  work stress affecting a marriage → ["Work", "Marriage"]). ONE topic if the',
    '  entry stays within one domain. Use the SINGULAR form ("Relationship", not "Relationships").',
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
    ...(restate
      ? [
          '- restatement: the writer\'s message rewritten as ONE short self-contained statement',
          '  in their own first-person voice, understandable with NO other context — resolve any',
          '  "it", "that", "this" to what they refer to. Keep their meaning and words where',
          '  possible; NEVER add facts or feelings they did not state.',
        ]
      : []),
    '',
    distortionGuide(),
    '',
    // Reference-only context so a chat fragment's "it/that" can be resolved in
    // the restatement — the analysis itself must stay on the final message.
    ...(restate && context && context.trim()
      ? ['Recent conversation (ONLY to resolve references — analyze and restate ONLY the entry below):', context.trim(), '']
      : []),
    `Situation: ${situation}`,
    `Thought: ${thought}`,
  ]
  if (behavior && behavior.trim()) lines.push(`Behavior: ${behavior}`)
  if (closing_note && closing_note.trim()) lines.push(`Closing note: ${closing_note}`)
  lines.push('', 'JSON:')
  return lines.join('\n')
}
