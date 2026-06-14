export interface AffirmationInput {
  title: string
  details: string
  targetDays: number
}

/**
 * Instruction for the deep model to write one personal affirmation rewarding a
 * completed challenge — grounded in what the writer committed to, about the
 * character they proved rather than the task itself. Output is the affirmation
 * only. Runs on-device.
 */
export function buildAffirmationPrompt({ title, details, targetDays }: AffirmationInput): string {
  const note = details.trim()
  return [
    `The writer just completed a ${targetDays}-day challenge: "${title}".`,
    note ? `What it involved:\n${note}` : '',
    '',
    `They showed up every single day for ${targetDays} days.`,
    'Write ONE short, first-person affirmation in the present tense that they can keep as',
    'a reminder of who they proved themselves to be — speak to their character and',
    'consistency, not the task. Warm and grounded, no clichés, no quotation marks.',
    'Output ONLY the affirmation, one sentence.',
  ]
    .filter(Boolean)
    .join('\n')
}
