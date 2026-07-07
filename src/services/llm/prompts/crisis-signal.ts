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
/**
 * Fast-model instruction: score distress risk from a rolling conversation summary.
 * The summary is third-person prose covering topics and feelings across many turns
 * ("They shared feeling overwhelmed at work. They also mentioned family stress…").
 * Same schema as buildCrisisPrompt (crisis_confidence), tuned for the summary
 * format — persistent low mood is not a crisis; only genuine self-harm/suicidal
 * signals trigger high.
 */
export function buildSummaryCrisisPrompt(summary: string): string {
  return [
    'You read a conversation summary and output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"crisis_confidence": number}',
    '- crisis_confidence: 0.0 to 1.0 — how strongly this conversation shows the person',
    '  is at risk of harming themselves or ending their life.',
    '- The summary captures themes from a private reflective conversation. Persistent',
    '  low mood, stress, anxiety, or self-criticism is normal — answer near 0.0.',
    '- Only score high if the conversation genuinely reveals wanting to die, self-harm,',
    '  or suicidal ideation. If there is no such sign, the answer is near 0.0.',
    '',
    `Summary: ${summary}`,
    '',
    'JSON:',
  ].join('\n')
}

export function buildCrisisPrompt({ situation, thought, behavior, closing_note }: CrisisPromptInput): string {
  const lines = [
    'You read a journal entry and output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"crisis_confidence": number}',
    '- crisis_confidence: 0.0 to 1.0 — how strongly THIS entry shows the writer is at risk',
    '  of harming themselves or ending their life. Score the risk of harm, not how negative,',
    '  stressed, or self-critical the entry is.',
    '- Everyday stress, worry, anxiety, sadness, frustration, or self-criticism is normal and',
    '  is NOT a crisis: answer near 0.0 for these.',
    '- Only an entry that genuinely expresses wanting to die or to hurt themselves is high. If',
    '  there is no such sign, the answer is near 0.0.',
    '',
    `Situation: ${situation}`,
    `Thought: ${thought}`,
  ]
  if (behavior && behavior.trim()) lines.push(`Behavior: ${behavior}`)
  if (closing_note && closing_note.trim()) lines.push(`Closing note: ${closing_note}`)
  lines.push('', 'JSON:')
  return lines.join('\n')
}
