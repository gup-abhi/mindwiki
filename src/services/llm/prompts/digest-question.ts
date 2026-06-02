export interface DigestQuestionInput {
  pattern: string
  correlation: string
}

/**
 * Instruction for the deep model to write one gentle reflection question from
 * the week's *aggregated* observations (derived labels only — never raw entry
 * text). On-device only. Output is a single question.
 */
export function buildDigestQuestionPrompt({ pattern, correlation }: DigestQuestionInput): string {
  return [
    'You are a thoughtful journaling companion. Based on these aggregated',
    "observations about the user's past week, write ONE open, gentle reflection",
    'question — a single sentence ending in "?". Do not give advice, reassurance,',
    'or any diagnosis. Output only the question, nothing else.',
    '',
    `Pattern: ${pattern}`,
    `Correlation: ${correlation}`,
    '',
    'Question:',
  ].join('\n')
}
