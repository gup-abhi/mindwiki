export interface PursuitDetailsInput {
  title: string
  existingDetails: string
  entryText: string
}

/**
 * Instruction for the deep model to maintain a short running note about
 * something the writer is working on — synthesize the new reflection into the
 * existing note rather than appending. Output is the note text only. Runs
 * on-device; raw entry text never leaves the device.
 */
export function buildPursuitDetailsPrompt({
  title,
  existingDetails,
  entryText,
}: PursuitDetailsInput): string {
  const existing = existingDetails.trim()
  return [
    `You maintain a short running note about something the writer is working on: "${title}".`,
    'Update the note using the new journal reflection below. Capture what it is, why it',
    'matters to them, and where things currently stand. Keep it to 2-4 plain sentences —',
    'warm and factual. Do NOT add headings or markdown, and do NOT copy the reflection',
    'word-for-word. Output ONLY the note text, no preamble.',
    '',
    existing ? `Current note:\n${existing}` : 'There is no note yet — write the first version.',
    '',
    `New reflection:\n${entryText}`,
  ].join('\n')
}
