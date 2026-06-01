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
    'Schema: {"emotion": string, "distortion": string, "mood_score": number}',
    '- emotion: the primary emotion (one or two words).',
    '- distortion: the main cognitive distortion, or "none".',
    '- mood_score: 0.0 (very negative) to 1.0 (very positive).',
    '',
    `Situation: ${situation}`,
    `Thought: ${thought}`,
    '',
    'JSON:',
  ].join('\n')
}
