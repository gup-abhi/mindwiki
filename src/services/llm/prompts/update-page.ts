export interface UpdatePageInput {
  title: string
  category: string | null
  existingContent: string
  situation: string
  thought: string
}

/**
 * Instruction for the deep model to (re)synthesize a wiki page that incorporates
 * a new entry — synthesize, don't append. Output is the page's markdown only.
 * Runs on-device only; raw entry text never leaves the device.
 */
export function buildUpdatePagePrompt({
  title,
  category,
  existingContent,
  situation,
  thought,
}: UpdatePageInput): string {
  const existing = existingContent.trim()
  return [
    `You maintain a personal wiki page titled "${title}"${category ? ` (${category})` : ''}.`,
    'Rewrite the page to integrate the new journal entry below. Synthesize a coherent,',
    'compassionate summary in markdown — do not just append; merge new insight into the',
    'existing understanding. Keep it concise (a few short paragraphs). Output ONLY the',
    'updated page content, no preamble.',
    '',
    existing ? `Current page:\n${existing}` : 'The page is currently empty — write the first version.',
    '',
    'New entry:',
    `- Situation: ${situation}`,
    `- Thought: ${thought}`,
    '',
    'Updated page:',
  ].join('\n')
}
