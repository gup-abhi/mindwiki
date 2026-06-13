export interface CheckinQuestionInput {
  title: string
  details: string
}

/**
 * Instruction for the deep model to write one warm check-in question about
 * something the writer is working on, grounded in its running note. Output is
 * the question only. Runs on-device.
 */
export function buildCheckinQuestionPrompt({ title, details }: CheckinQuestionInput): string {
  const note = details.trim()
  return [
    `The writer has been working on: "${title}".`,
    note ? `What you know so far:\n${note}` : '',
    '',
    'Write ONE short, warm, open question checking in on how this is going — the kind a',
    'thoughtful friend would ask. Ground it in what you know, but do not give advice or',
    'assume progress. Output ONLY the question, one sentence.',
  ]
    .filter(Boolean)
    .join('\n')
}
