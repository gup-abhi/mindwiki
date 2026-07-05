import { synthesisHint } from '../reference'

export interface UpdatePageInput {
  title: string
  category: string | null
  existingContent: string
  situation: string
  thought: string
  /** Canonical distortion tag for the entry (optional) — grounds the synthesis. */
  distortion?: string | null
  /** The writer's latest balanced reframe of this belief (belief pages only) — so
   *  the page reflects how they're revising the belief, not just restating it. */
  reframe?: string | null
  /** Approx. whole weeks between the page's last update and this reflection. Lets
   *  synthesis express evolution ("lately this barely comes up") instead of timeless
   *  prose. Only surfaced past RECENCY_HINT_WEEKS, so daily journaling stays silent. */
  weeksSinceUpdate?: number | null
}

/** Below this gap the recency hint is noise (a daily journaler re-touches a page
 *  constantly), so it is only surfaced once a page has genuinely gone quiet. */
const RECENCY_HINT_WEEKS = 3

// The house style every wiki page is written in. Shared by first-time synthesis,
// per-entry updates, and the regenerate pass so they can't drift apart.
const PAGE_STYLE = [
  'Style: write ONE consolidated, human-readable summary — a few flowing paragraphs of warm,',
  'plain prose that a person would actually want to read. Never use labels or section headings',
  'like "Situation:", "Thought:", "Behavior:", or "#" markdown headings — merge everything into',
  'natural prose. Address the reader directly as "you"; the page is about THEIR patterns and',
  'tendencies. Never write in the first person ("I", "my"), and never write a generic dictionary',
  'definition. If the topic is a person or place, describe it in relation to the reader',
  '("your", "you"). Be specific and concise — no generic filler.',
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
  distortion,
  reframe,
  weeksSinceUpdate,
}: UpdatePageInput): string {
  const existing = existingContent.trim()
  // Present the new material as one reflection. Labelled "Situation:/Thought:"
  // bullets get parroted back by the small model as literal headings, which is
  // not what a synthesized wiki page should look like.
  const reflection = [situation.trim(), thought.trim()].filter(Boolean).join('\n\n')
  // KB grounding as a single instruction line (never a labelled data block —
  // those leak into the page). Empty when there's no distortion.
  const hint = synthesisHint(distortion)
  // A belief the writer has reframed: fold their revised view in as a single
  // instruction line (not a labelled data block — those leak), so the page reads
  // as a belief they're actively working through rather than one they accept.
  const reframeLine =
    reframe && reframe.trim()
      ? `The writer has been actively challenging this belief and now holds a more balanced view: "${reframe.trim()}". Let the page reflect that they are revising this belief, not that they fully accept it. Do not copy this line verbatim.`
      : ''
  // Recency framing: only when the page has genuinely gone quiet. Invites the model
  // to note evolution (intensified / eased / shifted) without inventing dated events.
  const recencyLine =
    existing && weeksSinceUpdate != null && weeksSinceUpdate >= RECENCY_HINT_WEEKS
      ? `It has been roughly ${weeksSinceUpdate} weeks since this page was last shaped, and the reflection below is from today. Where it fits naturally, let the page reflect how this theme has changed over that time — whether it has intensified, eased, or shifted focus — but do NOT invent specific past events, dates, or feelings you were not told about.`
      : ''
  return [
    `You maintain a personal wiki page titled "${title}"${category ? ` (${category})` : ''}.`,
    'Weave the new reflection below into the page. Synthesize — merge its insight into the',
    'existing understanding rather than appending or restating it.',
    ...PAGE_STYLE,
    ...(hint ? [hint] : []),
    ...(reframeLine ? [reframeLine] : []),
    ...(recencyLine ? [recencyLine] : []),
    'Do NOT copy the reflection word-for-word. Output ONLY the page content, no preamble.',
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
 * Instruction for the deep model to rewrite an EXISTING page into the house
 * style without changing its substance — used to bring older pages (which echo
 * the entry's "Situation:/Thought:" skeleton, or use the wrong voice) into a
 * consolidated, readable form. Output is the page content only.
 */
export function buildRewritePagePrompt({ title, category, content }: RewritePageInput): string {
  return [
    `Rewrite this personal wiki page titled "${title}"${category ? ` (${category})` : ''}.`,
    'Keep the SAME facts and meaning, but rewrite the wording completely — do NOT copy sentences',
    'unchanged. The current page is badly formatted; fix it:',
    '- DELETE any "Situation", "Thought", "Behavior" labels or headings and any "#" headings.',
    '  Merge that content into flowing paragraphs — the result must read as one consolidated summary,',
    '  not a list of labelled sections.',
    '- Turn first person into second person: "I feel anxious" → "You feel anxious".',
    '- Turn a dictionary definition into a direct observation about the reader: "Catastrophizing is',
    '  when someone assumes the worst" → "You tend to assume the worst will happen".',
    ...PAGE_STYLE,
    'Output ONLY the rewritten page, no preamble, no headings, no labels.',
    '',
    `Page to rewrite:\n${content.trim()}`,
  ].join('\n')
}
