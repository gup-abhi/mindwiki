export interface TagPromptInput {
  situation: string
  thought: string
}

/**
 * Instruction for the fast model to tag an entry. Output is constrained to a
 * single JSON object matching EntryTagSchema. Runs on-device only.
 */
export function buildTagPrompt({ situation, thought }: TagPromptInput): string {
  return [
    'You analyze a journal entry and output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"emotion": string, "distortion": string, "mood_score": number, "crisis_confidence": number, "topic": string}',
    '- emotion: the primary emotion (one or two words).',
    '- distortion: the main cognitive distortion, or "none".',
    '- mood_score: 0.0 (very negative) to 1.0 (very positive).',
    '- crisis_confidence: 0.0 to 1.0 — likelihood the writer is in crisis or at risk of self-harm.',
    '- topic: a short 1-3 word theme for this entry (e.g. "Work", "Public speaking", "Family").',
    '',
    `Situation: ${situation}`,
    `Thought: ${thought}`,
    '',
    'JSON:',
  ].join('\n')
}
