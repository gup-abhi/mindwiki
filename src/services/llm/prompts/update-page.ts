export interface UpdatePageInput {
  title: string
  category: string | null
  existingContent: string
  situation: string
  thought: string
}

// The one voice every wiki page is written in. Shared by first-time synthesis,
// per-entry updates, and the regenerate pass so they can't drift apart.
const VOICE_RULES = [
  'Voice: always address the reader directly as "you" — this page is about THEIR patterns,',
  'feelings, and tendencies as they show up across their reflections. Never write in the',
  'first person ("I", "my"), and never write a generic dictionary definition of the topic.',
  'If the topic is a person or place, describe it in relation to the reader ("your", "you").',
]

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
    ...VOICE_RULES,
    'Do NOT add section headings (no "Situation", "Thought", or "#" markdown headings),',
    'and do NOT copy the reflection word-for-word. Output ONLY the page content, no preamble.',
    '',
    existing ? `Current page:\n${existing}` : 'The page is currently empty — write the first version.',
    '',
    `New reflection:\n${reflection}`,
  ].join('\n')
}

export interface RewritePageInput {
  title: string
  category: string | null
  content: string
}

/**
 * Instruction for the deep model to rewrite an EXISTING page in the canonical
 * voice without changing its substance — used to bring older pages (written
 * before the voice was pinned) into a consistent voice. Output is markdown only.
 */
export function buildRewritePagePrompt({ title, category, content }: RewritePageInput): string {
  return [
    `Rewrite this personal wiki page titled "${title}"${category ? ` (${category})` : ''} in a new voice.`,
    'Keep the SAME facts and meaning, but change the wording so the whole page speaks directly to',
    'the reader in the second person. Rewrite every sentence — do NOT copy sentences unchanged.',
    'Transform the voice:',
    '- First person → second person: "I feel anxious" → "You feel anxious"; "my work" → "your work".',
    '- A dictionary definition → a direct observation: "Catastrophizing is when someone assumes the',
    '  worst" → "You tend to assume the worst will happen".',
    '- Third person about the reader → second person: "they avoid conflict" → "you avoid conflict".',
    ...VOICE_RULES,
    'Write a few short paragraphs of warm, plain prose. Do NOT add section headings (no "#" headings).',
    'Output ONLY the rewritten page, no preamble.',
    '',
    `Page to rewrite:\n${content.trim()}`,
  ].join('\n')
}
