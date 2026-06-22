export interface CrisisPromptInput {
  situation: string
  thought: string
  behavior?: string | null
  closing_note?: string | null
}

/**
 * Fast-model instruction: score crisis/self-harm risk only. This is the one
 * signal that must be synchronous (the entry routes to /crisis the instant it
 * saves), so the prompt is tiny — everything else is extracted by the deep model
 * in the background. Output is a single JSON object. Runs on-device only.
 */
export function buildCrisisPrompt({ situation, thought, behavior, closing_note }: CrisisPromptInput): string {
  const lines = [
    'You read a journal entry and output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"crisis_confidence": number}',
    '- crisis_confidence: 0.0 to 1.0 — likelihood the writer is at risk of suicide or',
    '  self-harm SPECIFICALLY. Score the risk of harm, not how upset or negative the entry is.',
    'Calibration:',
    '  - Everyday stress, anxiety, self-doubt, sadness, frustration, or harsh self-criticism',
    '    with NO mention of self-harm, suicide, or not wanting to be alive → 0.0–0.1.',
    '  - Hopelessness or feeling life is not worth living, but no thought of self-harm → ~0.5.',
    '  - Any thought, wish, or plan of dying, suicide, or hurting oneself → 0.9–1.0.',
    '',
    `Situation: ${situation}`,
    `Thought: ${thought}`,
  ]
  if (behavior && behavior.trim()) lines.push(`Behavior: ${behavior}`)
  if (closing_note && closing_note.trim()) lines.push(`Closing note: ${closing_note}`)
  lines.push('', 'JSON:')
  return lines.join('\n')
}
