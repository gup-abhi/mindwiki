import { synthesisHint } from '../reference'
import { type EmotionAggregate } from '@/services/wiki/aggregates'

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

/** Cap on the existing page folded into the prompt, so a large page + reflection +
 *  the 400-token generation budget can't graze the deep model's 2048 n_ctx (past
 *  which llama.rn silently context-shifts, dropping the instructions). Sized above
 *  the ~1600 chars a 400-token synthesis produces, so normal pages are never
 *  touched — only a page near WikiContentSchema's 4000-char ceiling (e.g. legacy)
 *  gets trimmed. Keep the opening: it carries the page's gist, and synthesis
 *  re-consolidates from there. Mirrors conversation.ts's MAX_PAGE_CHARS guard. */
const MAX_EXISTING_CHARS = 2400

/**
 * Tighter cap for re-grounding prompts, where past entries carry the authority
 * and the existing page is just a prior (~300 tokens). Leaves room for ~6
 * entries at ~130 chars each plus instructions within the 2048 n_ctx.
 */
const MAX_EXISTING_CHARS_REGROUND = 1200

/** Maximum past entries sampled during a re-grounding pass. Keeps total prompt
 *  well within 2048 n_ctx (~1400 tokens projected). */
const MAX_REGROUND_ENTRIES = 6

/** Rough per-entry overhead in the prompt block for date + separator chars. */
const ENTRY_META_OVERHEAD = 18 // "YYYY-MM-DD — \n\n"

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
  const trimmed = existingContent.trim()
  const existing =
    trimmed.length > MAX_EXISTING_CHARS ? `${trimmed.slice(0, MAX_EXISTING_CHARS)}…` : trimmed
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

// ─────────────────────────────────────────────────────────────────────────────
// Emotion aggregate prompt
// ─────────────────────────────────────────────────────────────────────────────

export interface EmotionPageInput {
  title: string
  category: string | null
  existingContent: string
  data: EmotionAggregate
  /** Whole weeks since the page was last updated, for temporal framing. */
  weeksSinceUpdate: number | null
}

/** Cap for existing emotion page content folded into the prompt. Emotion pages
 *  grow large (highest-traffic category) but the aggregate should speak from
 *  the data, not the length of the existing mush. */
const MAX_EXISTING_CHARS_EMOTION = 800

/**
 * Instruction for the deep model to synthesise an emotion page from aggregate
 * data rather than per-entry incremental prose. Output is the page's markdown
 * only. Runs on-device; raw entry text never leaves the device.
 */
export function buildEmotionPagePrompt({
  title,
  existingContent,
  data,
  weeksSinceUpdate,
}: EmotionPageInput): string {
  const trimmed = existingContent.trim()
  const existing = trimmed.length > MAX_EXISTING_CHARS_EMOTION
    ? `${trimmed.slice(0, MAX_EXISTING_CHARS_EMOTION)}…`
    : trimmed

  const situationLines = data.topSituations.length > 0
    ? data.topSituations.map((s) => `  • ${s.pattern} — mentioned ${s.count} time${s.count !== 1 ? 's' : ''}`).join('\n')
    : '  (not enough data yet)'

  const trendLine = (() => {
    if (data.moodTrend.direction === 'insufficient_data') return ''
    const recent = data.moodTrend.recentAvg != null ? data.moodTrend.recentAvg.toFixed(1) : '?'
    const prior = data.moodTrend.priorAvg != null ? data.moodTrend.priorAvg.toFixed(1) : '?'
    const dir = data.moodTrend.direction === 'up' ? 'improving slightly' :
                data.moodTrend.direction === 'down' ? 'intensifying slightly' :
                'roughly stable'
    return `- Mood when feeling this: ${recent} (last 4 weeks) vs ${prior} (prior 4 weeks) — ${dir}`
  })()

  const freqLine = data.recentCount.last8weeks > 0
    ? `- Frequency: ~${Math.round(data.recentCount.last8weeks / 8)} check-ins per week over the past 8 weeks`
    : ''

  const recentLines = data.recentExamples.length > 0
    ? '\n' + data.recentExamples.map((e) => {
        const date = new Date(e.created_at).toISOString().slice(0, 10)
        const body = [e.situation.trim(), e.thought.trim()].filter(Boolean).join('. ')
        return `  ${date} — ${body}`
      }).join('\n')
    : ''

  const recencyLine =
    weeksSinceUpdate != null && weeksSinceUpdate >= 2
      ? `\nIt has been about ${weeksSinceUpdate} weeks since this page was last updated. Where it fits naturally, reflect how this emotion has changed over that time.`
      : ''

  return [
    `You maintain a personal wiki page titled "${title}" (emotion).`,
    '',
    `This page tracks how the writer experiences ${title.toLocaleLowerCase()} — not a list of events,`,
    'but an evolving picture of what triggers it, how intense it feels, and how it\'s changing.',
    '',
    'Re-synthesise the page from the aggregate data below. Do NOT just repeat the data —',
    'turn it into warm, readable prose about the writer\'s patterns with this emotion.',
    '',
    'Style:',
    '- Write in second person ("you", "your") — the page is about THEIR patterns.',
    '- Never use labels, headings, or sections like "Situation:", "Thought:", or "#" marks.',
    '- Be specific and concise — no generic filler.',
    '- If there are concrete recent examples, weave in 1-2 naturally ("Recently, when…").',
    '- If the trend is up or down, reflect that ("This has been coming up more lately…").',
    '- If there\'s no trend yet (new pattern), just describe what you see so far.',
    ...(recencyLine ? [recencyLine] : []),
    '',
    'Aggregate data:',
    ...(freqLine ? [freqLine] : []),
    ...(trendLine ? [trendLine] : []),
    'Most common triggers:',
    situationLines,
    ...(recentLines ? [`\nRecent examples:${recentLines}`] : []),
    '',
    existing ? `Current page (as prior):\n${existing}` : 'The page is currently empty — write the first version.',
    '',
    'Output ONLY the re-synthesised page content, no preamble, no headings, no labels.',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-grounding prompt
// ─────────────────────────────────────────────────────────────────────────────

export interface PastEntry {
  situation: string
  thought: string
  created_at: number
}

export interface ReGroundInput extends UpdatePageInput {
  pastEntries: PastEntry[]
}

/**
 * Format past entries into a compact date-keyed block. No "Situation:/Thought:"
 * labels — those leak into output as literal headings. Dedups by full text
 * (identical situation+thought pairs produce one entry, the newest date wins).
 */
function formatPastEntries(entries: PastEntry[]): string {
  if (entries.length === 0) return ''
  // Sort newest-first so dedup always keeps the most recent version
  const sorted = [...entries].sort((a, b) => b.created_at - a.created_at)
  const seen = new Set<string>()
  const deduped: PastEntry[] = []
  for (const e of sorted) {
    const key = `${e.situation}|${e.thought}`.trim().toLowerCase()
    if (key && !seen.has(key)) {
      seen.add(key)
      deduped.push(e)
    }
  }
  // Format newest-first, truncating each entry to fit within total context
  const lines: string[] = []
  for (const e of deduped) {
    const date = new Date(e.created_at).toISOString().slice(0, 10)
    const body = [e.situation.trim(), e.thought.trim()].filter(Boolean).join('. ')
    // Trim individual entries to ~200 chars so 6 entries fit under ~1200 chars
    const maxBody = 200
    const trimmed = body.length > maxBody ? `${body.slice(0, maxBody)}…` : body
    lines.push(`${date} — ${trimmed}`)
  }
  return lines.join('\n')
}

/**
 * Instruction for the deep model to re-synthesize a wiki page from its source
 * entries instead of the incremental telephone chain. The model sees the current
 * page as a prior plus K past entries as ground truth. Used at periodic intervals
 * (every 10th synthesis) to correct drift.
 */
export function buildReGroundPrompt({
  title,
  category,
  existingContent,
  situation,
  thought,
  distortion,
  reframe,
  weeksSinceUpdate,
  pastEntries,
}: ReGroundInput): string {
  const trimmed = existingContent.trim()
  const existing =
    trimmed.length > MAX_EXISTING_CHARS_REGROUND
      ? `${trimmed.slice(0, MAX_EXISTING_CHARS_REGROUND)}…`
      : trimmed
  const reflection = [situation.trim(), thought.trim()].filter(Boolean).join('\n\n')
  const hint = synthesisHint(distortion)
  const reframeLine =
    reframe && reframe.trim()
      ? `The writer has been actively challenging this belief and now holds a more balanced view: "${reframe.trim()}". Let the page reflect that they are revising this belief, not that they fully accept it. Do not copy this line verbatim.`
      : ''
  const recencyLine =
    existing && weeksSinceUpdate != null && weeksSinceUpdate >= RECENCY_HINT_WEEKS
      ? `It has been roughly ${weeksSinceUpdate} weeks since this page was last shaped, and the reflection below is from today. Where it fits naturally, let the page reflect how this theme has changed over that time — whether it has intensified, eased, or shifted focus — but do NOT invent specific past events, dates, or feelings you were not told about.`
      : ''
  const formattedPast = formatPastEntries(pastEntries)

  return [
    `You maintain a personal wiki page titled "${title}"${category ? ` (${category})` : ''}.`,
    'Re-synthesize it based on the current page AND the past entries below.',
    ...PAGE_STYLE,
    ...(hint ? [hint] : []),
    ...(reframeLine ? [reframeLine] : []),
    ...(recencyLine ? [recencyLine] : []),
    'The "Past entries" below are actual journal entries that shaped this topic.',
    'Ground your synthesis in these as the primary evidence — the current page is',
    'a prior summary, not the source of truth.',
    'Do NOT copy any entry word-for-word; synthesise.',
    'Output ONLY the page content, no preamble.',
    '',
    existing ? `Current page (as prior):\n${existing}` : 'The page is currently empty — write the first version.',
    '',
    `Past entries (newest first):\n${formattedPast}`,
    '',
    `New entry:\n${reflection}`,
  ].join('\n')
}
