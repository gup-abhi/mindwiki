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
  // Present the new material as one reflection. Labelled "Situation:/Thought:"
  // bullets get parroted back by the small model as literal headings, which is
  // not what a synthesized wiki page should look like.
  const reflection = [situation.trim(), thought.trim()].filter(Boolean).join('\n\n')
  return [
    `You maintain a personal wiki page titled "${title}"${category ? ` (${category})` : ''}.`,
    'Weave the new reflection below into the page. Synthesize — merge its insight into the',
    'existing understanding rather than appending or restating it. Write a few short',
    'paragraphs of warm, plain prose about this topic.',
    'Do NOT add section headings (no "Situation", "Thought", or "#" markdown headings),',
    'and do NOT copy the reflection word-for-word. Output ONLY the page content, no preamble.',
    '',
    existing ? `Current page:\n${existing}` : 'The page is currently empty — write the first version.',
    '',
    `New reflection:\n${reflection}`,
  ].join('\n')
}
