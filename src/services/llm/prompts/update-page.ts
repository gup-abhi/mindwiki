import { synthesisHint } from '../reference'
import { type EmotionAggregate } from '@/services/wiki/aggregates'
import { type TimingContext } from '@/types/wiki'
import {
  estimatePromptTokens,
  truncateMiddle,
  PROMPT_INPUT_BUDGET,
} from './budget'

export interface UpdatePageInput {
  title: string
  category: string | null
  existingContent: string
  situation: string
  thought: string
  /** The user's own balanced perspective (entry step 5) — their CBT restructuring
   *  in their own words. Folded into the reflection as the "revising, not accepting"
   *  signal, like the belief reframe line but from the user themselves. */
  closingNote?: string | null
  /** Raw CBT step-4 behaviour — how the writer responded. Folded into the
   *  reflection as natural evidence (a single context line), never a labelled
   *  heading that could leak into generated prose. Null/empty/whitespace-only
   *  is omitted. */
  behavior?: string | null
  /** Canonical distortion tag for the entry (optional) — grounds the synthesis. */
  distortion?: string | null
  /** The writer's latest balanced reframe of this belief (belief pages only) — so
   *  the page reflects how they're revising the belief, not just restating it. */
  reframe?: string | null
  /** F-4 — deterministic timing context for time-accurate recency wording.
   *  Computed by `computeTiming` in the wiki engine (calendar-day arithmetic +
   *  validity checks) and passed in. Null when there is no real prior content
   *  (first synthesis) or no timing info is available — the prompt then emits
   *  no evolution framing and uses neutral "new reflection" wording.
   *  The prompt builder never recomputes timing and never uses Date.now(). */
  timing?: TimingContext | null
}

/** F-4 — recency framing floor: a daily / next-day journaler's constant
 *  re-touches of a page must NOT be curated into noisy "X days ago" prose, so
 *  both the per-reflection date descriptor and the evolution framing stay
 *  silent at-or-below this gap. At or above {@link RECENCY_DAY_FLOOR}+1 day,
 *  day wording becomes accurate and useful. */
const RECENCY_DAY_FLOOR = 7

/** F-4 — the 3-week boundary tested explicitly: below 21 days, day wording
 *  is more accurate near the boundary; at-or-above 21 days the rounded-week
 *  approximation reads more naturally ("about 3 weeks" instead of "21 days"). */
const RECENCY_WEEK_THRESHOLD = 21

/** Map a whole-day count into the appropriate natural-language age fragment
 *  for either the reflection descriptor or the evolution framing. Returns the
 *  empty string when age is null/invalid (the descriptor's caller suppresses
 *  the bracketed clause itself). */
function ageWordingDays(days: number): string {
  if (days >= RECENCY_WEEK_THRESHOLD) {
    const weeks = Math.round(days / 7)
    return `about ${weeks} weeks ago`
  }
  return `${days} days ago`
}

// The fully rendered prompt is bounded to PROMPT_INPUT_BUDGET in
// budgetPromise() below — the per-content char caps that used to live here
// are gone (F-3A): the token-budget logic owns truncation, applied to the
// rendered prompt as a whole, not to a single field.

/** Maximum past entries sampled during a re-grounding pass. Kept as an absolute
 *  upper bound on the historical sample; the token budget then trims further if
 *  the full prompt still overruns. */
const MAX_REGROUND_ENTRIES = 6

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
/** Assemble the new-reflection block: situation + thought + (optional)
 *  behavior + (optional) closing note, as natural prose evidence — never
 *  labelled headings that could leak into output. */
function renderReflection(input: {
  situation: string
  thought: string
  behavior?: string | null
  closingNote?: string | null
}): string {
  // Present the new material as one reflection. Labelled "Situation:/Thought:"
  // bullets get parroted back by the small model as literal headings, which is
  // not what a synthesized wiki page should look like.
  const reflectionParts = [input.situation.trim(), input.thought.trim()]
  // The writer's response (CBT step 4) — folded in as natural context, like the
  // closing note (no labelled section heading, which would leak into output).
  if (input.behavior && input.behavior.trim()) {
    reflectionParts.push(`How they responded: ${input.behavior.trim()}`)
  }
  // The closing note is the user's own balanced perspective (the CBT
  // reframe they wrote themselves). Fold it in as context the writer is
  // actively revising — not as a standalone labelled section. When present,
  // prefix it so the model reads it as the user-revised view, not a second
  // thought to synthesise into generic content.
  if (input.closingNote && input.closingNote.trim()) {
    reflectionParts.push(
      `The writer's own reframe of this: "${input.closingNote.trim()}"`
    )
  }
  return reflectionParts.filter(Boolean).join('\n\n')
}

/** F-4 — the `New reflection:` block heading with an optional calendar-honest
 *  date descriptor. Spec wording rules:
 *  • `entryAgeDays === 0`   → may say "today" (and ONLY this case may say today)
 *  • `entryAgeDays 1..floor` → stay silent on the date (don't curate daily/next-
 *    day journaler's constant re-touches into noisy "X days ago" prose)
 *  • `entryAgeDays > floor`  → date descriptor ("8 days ago" / "8 days ago" /
 *    "about N weeks ago" once past the 3-week boundary)
 *  • historical entry (predates the page's last shaping) — folded in here too.
 *    The descriptor reads as "an older entry from <words ago>" so the model does
 *    NOT present it as the current subject of change.
 *  • future / invalid entry → neutral "New reflection:" and the directive from
 *    {@link recencyDirective} replaces the descriptor (see its own rules). */
function reflectionHeadingFor(timing: TimingContext | null | undefined): string {
  if (timing == null) return 'New reflection'
  if (timing.isFutureEntry) return 'New reflection'
  if (timing.isHistoricalEntry) {
    if (timing.entryAgeDays == null || timing.entryAgeDays <= RECENCY_DAY_FLOOR) {
      return 'New reflection (older entry)'
    }
    return `New reflection (older entry, ${ageWordingDays(timing.entryAgeDays)})`
  }
  const age = timing.entryAgeDays
  if (age == null) return 'New reflection'
  if (age === 0) return 'New reflection written today'
  if (age <= RECENCY_DAY_FLOOR) return 'New reflection'
  return `New reflection written ${ageWordingDays(age)}`
}

/** F-4 — the evolution framing line ("how has this theme changed over X days /
 *  N weeks"), only when the page genuinely went quiet FIRST (a positive gap
 *  above the recency floor) AND the entry is a legit newer-after-page event
 *  (not historical, not future). Otherwise empty — historical entries add
 *  evidence; future/corrupt entries can't be time-located. The wording still
 *  carries the anti-fabrication guard: do not invent specific past events /
 *  dates / feelings the page wasn't told about. */
function evolutionFramingFor(
  hasPrior: boolean,
  timing: TimingContext | null | undefined
): string {
  if (!hasPrior || timing == null) return ''
  if (timing.isFutureEntry || timing.isHistoricalEntry) return ''
  const gap = timing.gapDays
  if (gap == null || gap <= RECENCY_DAY_FLOOR) return ''
  const age = gap >= RECENCY_WEEK_THRESHOLD
    ? `roughly ${Math.round(gap / 7)} weeks`
    : `${gap} days`
  return `It has been ${age} since this page was last shaped. Where it fits naturally, let the page reflect how this theme has changed over that time — whether it has intensified, eased, or shifted focus — but do NOT invent specific past events, dates, or feelings you were not told about.`
}

/** F-4 — the safety-net directive for a future-dated / invalid-timestamp entry.
 *  The prompt is required to word it as "this reflection" (neutral) and must
 *  NOT fabricate any temporal-evolution storyline (negative/zero-week fiction,
 *  "changed over time" claims). Returns a single instruction line — empty
 *  when the timing is not future-invalid. */
function futureTimingDirective(timing: TimingContext | null | undefined): string {
  if (timing == null || !timing.isFutureEntry) return ''
  return 'Treat this reflection as the current evidence — its timestamp is in the future and may be corrupted, so do not place it on a timeline or invent how the theme has changed over time.'
}

/** The KB-grounding hint line + the writer's active reframe of the belief.
 *  Both are instruction lines (never labelled data blocks — those leak). */
function groundingLines(input: {
  distortion?: string | null
  reframe?: string | null
}): string[] {
  const hint = synthesisHint(input.distortion)
  const reframeLine =
    input.reframe && input.reframe.trim()
      ? `The writer has been actively challenging this belief and now holds a more balanced view: "${input.reframe.trim()}". Let the page reflect that they are revising this belief, not that they fully accept it. Do not copy this line verbatim.`
      : ''
  return [
    ...(hint ? [hint] : []),
    ...(reframeLine ? [reframeLine] : []),
  ]
}

/** Trim the prior block (the LOWEST-priority content under F-3A) so the FULL
 *  rendered prompt — instructions + reflection + prior — fits the input
 *  token budget. Preserves the prior's head and tail by middle-truncating:
 *  head carries the gist, tail carries the most-recent state, synthesis
 *  re-consolidates from both. Returns the trimmed prior string (no label).
 *  `promptSansPrior` is the prompt shell with the prior slot replaced by the
 *  empty string, so its token estimate is the untrimmable budget. */
function budgetPrior(promptSansPrior: string, priorBlock: string): string {
  const without = estimatePromptTokens(promptSansPrior)
  if (without >= PROMPT_INPUT_BUDGET) {
    // Even with NO prior the prompt overshoots — keep a minimal head/tail so the
    // model still sees a glimpse. The instructions are already the highest
    // priority and are NOT trimmed here; this only trims the prior itself.
    return truncateMiddle(priorBlock, 0)
  }
  const room = PROMPT_INPUT_BUDGET - without
  // Walk the prior cap DOWN until its estimate fits `room` tokens. The estimator
  // is conservative, so we trim slightly more than strictly needed (correct —
  // we want the rendered prompt to comfortably fit, not graze the budget).
  const priorTokens = estimatePromptTokens(priorBlock)
  if (priorTokens <= room) return priorBlock // no trim needed
  const ratio = priorBlock.length / Math.max(1, priorTokens) // chars/token
  let cap = Math.floor(room * ratio)
  while (cap > 0 && estimatePromptTokens(truncateMiddle(priorBlock, cap)) > room) {
    cap = Math.floor(cap * 0.8)
  }
  return truncateMiddle(priorBlock, cap)
}

/** Assemble a fully-rendered update-style prompt from its immutable instruction
 *  block + the (already-trimmed) prior block + the current reflection. The
 *  prior block is passed in already bounded, so this is pure concatenation. */
function assembleUpdatePrompt(params: {
  instructionLines: string[]
  priorBlock: string
  reflectionHeading: string
  reflection: string
}): string {
  return [
    ...params.instructionLines,
    '',
    params.priorBlock,
    '',
    `${params.reflectionHeading}:\n${params.reflection}`,
  ].join('\n')
}

export function buildUpdatePagePrompt({
  title,
  category,
  existingContent,
  situation,
  thought,
  closingNote,
  behavior,
  distortion,
  reframe,
  timing,
}: UpdatePageInput): string {
  let reflection = renderReflection({ situation, thought, behavior, closingNote })
  const hasPrior = existingContent.trim().length > 0
  const evolution = evolutionFramingFor(hasPrior, timing)
  const futureDirective = futureTimingDirective(timing)
  const instructionLines = [
    `You maintain a personal wiki page titled "${title}"${category ? ` (${category})` : ''}.`,
    'Weave the new reflection below into the page. Synthesize — merge its insight into the',
    'existing understanding rather than appending or restating it.',
    ...PAGE_STYLE,
    ...groundingLines({ distortion, reframe }),
    ...(evolution ? [evolution] : []),
    ...(futureDirective ? [futureDirective] : []),
    'Do NOT copy the reflection word-for-word. Output ONLY the page content, no preamble.',
  ]
  // Measure the prompt with the prior slot EMPTY to get the untrimmable budget,
  // then trim the prior to fit the remaining room (the prior is the lowest-
  // priority content under F-3A — it's trimmed before any instruction or the
  const reflectionHeading = reflectionHeadingFor(timing)
  // current reflection would ever be touched).
  let sansPrior = assembleUpdatePrompt({
    instructionLines, priorBlock: '', reflectionHeading, reflection,
  })
  // Current evidence outranks the prior. Trim it by grapheme-safe middle cuts
  // before allowing the prior to consume the remaining rendered-prompt budget.
  while (estimatePromptTokens(sansPrior) > PROMPT_INPUT_BUDGET && reflection.length > 64) {
    reflection = truncateMiddle(reflection, Math.floor(reflection.length * 0.8))
    sansPrior = assembleUpdatePrompt({ instructionLines, priorBlock: '', reflectionHeading, reflection })
  }
  const priorBlock = hasPrior
    ? `Current page:\n${budgetPrior(sansPrior, existingContent.trim())}`
    : 'The page is currently empty — write the first version.'
  let prompt = assembleUpdatePrompt({ instructionLines, priorBlock, reflectionHeading, reflection })
  while (estimatePromptTokens(prompt) > PROMPT_INPUT_BUDGET && reflection.length > 64) {
    reflection = truncateMiddle(reflection, Math.floor(reflection.length * 0.8))
    const shell = assembleUpdatePrompt({ instructionLines, priorBlock: '', reflectionHeading, reflection })
    const trimmedPrior = hasPrior ? `Current page:\n${budgetPrior(shell, existingContent.trim())}` : priorBlock
    prompt = assembleUpdatePrompt({ instructionLines, priorBlock: trimmedPrior, reflectionHeading, reflection })
  }
  return prompt
}export interface RewritePageInput {
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
export function buildRewritePagePrompt({
  title,
  category,
  content,
}: RewritePageInput): string {
  const instructions = [
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
  ]
  const shell = [...instructions, '', 'Page to rewrite:\n'].join('\n')
  return `${shell}${budgetPrior(shell, content.trim())}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Emotion aggregate prompt
// ─────────────────────────────────────────────────────────────────────────────

export interface EmotionPageInput {
  title: string
  category: string | null
  existingContent: string
  data: EmotionAggregate
  /** F-4 — deterministic timing context (calendar-day gap from the page's last
   *  aggregate to now). Null when no prior content. Same input shape as the
   *  per-entry builders; emotion aggregate has no single dated reflection so
   *  only `gapDays` carries wording (the rest is ignored). */
  timing?: TimingContext | null
}

/**
 * Instruction for the deep model to synthesise an emotion page from aggregate
 * data rather than per-entry incremental prose. Output is the page's markdown
 * only. Runs on-device; raw entry text never leaves the device.
 */
export function buildEmotionPagePrompt({
  title,
  existingContent,
  data,
  timing,
}: EmotionPageInput): string {
  let situationLines = data.topSituations.length > 0
    ? data.topSituations.map((s) => `  • ${truncateMiddle(s.pattern, 240)} — mentioned ${s.count} time${s.count !== 1 ? 's' : ''}`).join('\n')
    : '  (not enough data yet)'

  const trendLine = (() => {
    if (data.moodTrend.direction === 'insufficient_data') return ''
    const recent = data.moodTrend.recentAvg != null ? data.moodTrend.recentAvg.toFixed(1) : '?'
    const priorAvg = data.moodTrend.priorAvg != null ? data.moodTrend.priorAvg.toFixed(1) : '?'
    const dir = data.moodTrend.direction === 'up' ? 'improving slightly' :
                data.moodTrend.direction === 'down' ? 'intensifying slightly' :
                'roughly stable'
    return `- Mood when feeling this: ${recent} (last 4 weeks) vs ${priorAvg} (prior 4 weeks) — ${dir}`
  })()

  const freqLine = data.recentCount.last8weeks > 0
    ? `- Frequency: ~${Math.round(data.recentCount.last8weeks / 8)} check-ins per week over the past 8 weeks`
    : ''

  const formatExample = (e: typeof data.recentExamples[number]) => {
    const date = new Date(e.created_at).toISOString().slice(0, 10)
    // Behaviour and closing note are optional CBT steps; folded in as natural
    // context (no leaked heading), empty/whitespace-only values dropped.
    const parts = [e.situation.trim(), e.thought.trim()]
    if (e.behavior && e.behavior.trim()) parts.push(`How they responded: ${e.behavior.trim()}`)
    if (e.closing_note && e.closing_note.trim()) parts.push(`Their reframe: "${e.closing_note.trim()}"`)
    const body = truncateMiddle(parts.filter(Boolean).join('. '), 320)
    return `  ${date} — ${body}`
  }

  const recencyLine =
    timing != null && !timing.isFutureEntry && !timing.isHistoricalEntry &&
    timing.gapDays != null && timing.gapDays > RECENCY_DAY_FLOOR
      ? timing.gapDays >= RECENCY_WEEK_THRESHOLD
        ? `\nIt has been about ${Math.round(timing.gapDays / 7)} weeks since this page was last updated. Where it fits naturally, reflect how this emotion has changed over that time.`
        : `\nIt has been about ${timing.gapDays} days since this page was last updated. Where it fits naturally, reflect how this emotion has changed over that time.`
      : ''

  const hasPrior = existingContent.trim().length > 0
  let recentExamples = [...data.recentExamples]
  let recentExamplesBlock = recentExamples.length > 0
    ? `\nRecent examples:\n${recentExamples.map(formatExample).join('\n')}`
    : ''
  let dataBlock = [
    'Aggregate data:',
    ...(freqLine ? [freqLine] : []),
    ...(trendLine ? [trendLine] : []),
    'Most common triggers:',
    situationLines,
  ].join('\n')

  const instructionLines = [
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
    recencyLine,
  ].filter(Boolean)

  // F-3A budget: instructions → current reflection (none for emotion) → recent
  // historical examples (the data block here) → existing page prior (lowest).
  // Trim the prior FIRST; only if that's not enough do we shrink the recent-
  // examples block by dropping its middle (preserving the newest + oldest
  // examples, the timeline spread the aggregate needs).
  const assemble = (priorBlock: string, recentBlock: string): string => [
    ...instructionLines,
    '',
    dataBlock,
    recentBlock,
    '',
    priorBlock,
    '',
    'Output ONLY the re-synthesised page content, no preamble, no headings, no labels.',
  ].join('\n')

  // Measure with empty prior + full recent examples to get the trim budget.
  const sansPrior = assemble('', recentExamplesBlock)
  let priorBlock = hasPrior
    ? `Current page (as prior):\n${budgetPrior(sansPrior, existingContent.trim())}`
    : 'The page is currently empty — write the first version.'
  let prompt = assemble(priorBlock, recentExamplesBlock)
  // Still over budget even with an empty prior → shrink the recent-examples
  // block (drop the middle entries, keep head+tail for timeline spread).
  if (estimatePromptTokens(prompt) > PROMPT_INPUT_BUDGET && data.recentExamples.length > 0) {
    // Keep oldest (head) and newest (tail); drop the middle until it fits.
    while (recentExamples.length > 2 && estimatePromptTokens(assemble(priorBlock, `\nRecent examples:\n${recentExamples.map(formatExample).join('\n')}`)) > PROMPT_INPUT_BUDGET) {
      recentExamples.splice(Math.floor(recentExamples.length / 2), 1)
    }
    recentExamplesBlock = recentExamples.length > 0
      ? `\nRecent examples:\n${recentExamples.map(formatExample).join('\n')}`
      : ''
    // Recompute the prior against the now-shorter prompt shell.
    const sansPrior2 = assemble('', recentExamplesBlock)
    priorBlock = hasPrior
      ? `Current page (as prior):\n${budgetPrior(sansPrior2, existingContent.trim())}`
      : 'The page is currently empty — write the first version.'
    prompt = assemble(priorBlock, recentExamplesBlock)
  }
  // Aggregate trigger strings are current evidence too. If they still overflow
  // after example sampling, drop their middle while preserving the first/last
  // trigger and the surrounding instructions/prior.
  while (estimatePromptTokens(prompt) > PROMPT_INPUT_BUDGET && situationLines.length > 1) {
    const nextLength = Math.max(1, Math.floor(situationLines.length * 0.8))
    situationLines = truncateMiddle(situationLines, nextLength)
    dataBlock = [
      'Aggregate data:',
      ...(freqLine ? [freqLine] : []),
      ...(trendLine ? [trendLine] : []),
      'Most common triggers:',
      situationLines,
    ].join('\n')
    const shell = assemble('', recentExamplesBlock)
    priorBlock = hasPrior
      ? `Current page (as prior):\n${budgetPrior(shell, existingContent.trim())}`
      : 'The page is currently empty — write the first version.'
    prompt = assemble(priorBlock, recentExamplesBlock)
  }
  // Trigger strings can be bounded while two unusually dense examples still
  // keep the rendered prompt over budget. Drop example middle entries only as
  // a final evidence reduction; instructions and the aggregate data remain.
  while (estimatePromptTokens(prompt) > PROMPT_INPUT_BUDGET && recentExamples.length > 0) {
    recentExamples.splice(Math.floor(recentExamples.length / 2), 1)
    recentExamplesBlock = recentExamples.length > 0
      ? `\nRecent examples:\n${recentExamples.map(formatExample).join('\n')}`
      : ''
    const shell = assemble('', recentExamplesBlock)
    priorBlock = hasPrior
      ? `Current page (as prior):\n${budgetPrior(shell, existingContent.trim())}`
      : 'The page is currently empty — write the first version.'
    prompt = assemble(priorBlock, recentExamplesBlock)
  }
  return prompt
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-grounding prompt
// ─────────────────────────────────────────────────────────────────────────────

export interface PastEntry {
  situation: string
  thought: string
  /** The writer's response (CBT step 4) for this past entry. Natural evidence —
   *  included in the date-keyed block when non-empty, never a labelled heading. */
  behavior?: string | null
  /** The writer's own balanced perspective (CBT step 5). Natural evidence. */
  closing_note?: string | null
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
function formatPastBatch(entries: PastEntry[]): string {
  // Format a batch of past entries into a compact date-keyed block. No
  // "Situation:/Thought:" labels — those leak into output as literal headings.
  // Behaviour and closing note are folded in as natural evidence (separated so
  // the date-keyed block reads as prose context, never a labelled heading that
  // could leak into output). Trimmed/empty values are dropped.
  const lines: string[] = []
  for (const e of entries) {
    const date = new Date(e.created_at).toISOString().slice(0, 10)
    const parts = [e.situation.trim(), e.thought.trim()]
    if (e.behavior && e.behavior.trim()) parts.push(`How they responded: ${e.behavior.trim()}`)
    if (e.closing_note && e.closing_note.trim()) parts.push(`Their reframe: "${e.closing_note.trim()}"`)
    const body = parts.filter(Boolean).join('. ')
    // Trim individual entries so no single entry dominates the batch. The token
    // budget shrinks the whole batch if needed (drop the middle, keep head+tail).
    const maxBody = 200
    const trimmedBody = truncateMiddle(body, maxBody)
    lines.push(`${date} — ${trimmedBody}`)
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
  closingNote,
  behavior,
  distortion,
  reframe,
  timing,
  pastEntries,
}: ReGroundInput): string {
  const reflection = renderReflection({ situation, thought, behavior, closingNote })
  const hasPrior = existingContent.trim().length > 0
  const evolution = evolutionFramingFor(hasPrior, timing)
  const futureDirective = futureTimingDirective(timing)
  const reflectionHeading = reflectionHeadingFor(timing)
  const instructionLines = [
    `You maintain a personal wiki page titled "${title}"${category ? ` (${category})` : ''}.`,
    'Re-synthesize it based on the current page AND the past entries below.',
    ...PAGE_STYLE,
    ...groundingLines({ distortion, reframe }),
    ...(evolution ? [evolution] : []),
    ...(futureDirective ? [futureDirective] : []),
    'The "Past entries" below are actual journal entries that shaped this topic.',
    'Ground your synthesis in these as the primary evidence — the current page is',
    'a prior summary, not the source of truth.',
    'Do NOT copy any entry word-for-word; synthesise.',
    'Output ONLY the page content, no preamble.',
  ]
  // Sort+dedupe past entries once, newest-first, then cap at MAX_REGROUND_ENTRIES
  // (keep the newest K — most representative of the current state of the topic).
  const sorted = [...pastEntries].sort((a, b) => b.created_at - a.created_at)
  const seen = new Set<string>()
  const deduped: PastEntry[] = []
  for (const e of sorted) {
    const key = `${e.situation}|${e.thought}`.trim().toLowerCase()
    if (key && !seen.has(key)) { seen.add(key); deduped.push(e) }
  }
  const capped = deduped.slice(0, MAX_REGROUND_ENTRIES)

  const assemble = (priorBlock: string, pastBlock: string): string => [
    ...instructionLines,
    '',
    priorBlock,
    '',
    `Past entries (newest first):\n${pastBlock}`,
    '',
    `${reflectionHeading}:\n${reflection}`,
  ].join('\n')

  // F-3A priority order: instructions → current reflection (New entry block,
  // passed verbatim above) → historical past entries → existing page prior.
  // Trim the prior FIRST (budget against the shell with no prior), then if the
  // whole prompt is still over budget, shrink the past-entries batch by
  // dropping the middle entry each step (preserves head+tail = timeline spread).
  const sansPrior = assemble('', formatPastBatch(capped))
  let priorBlock = hasPrior
    ? `Current page (as prior):\n${budgetPrior(sansPrior, existingContent.trim())}`
    : 'The page is currently empty — write the first version.'
  let pastBatch = capped
  let prompt = assemble(priorBlock, formatPastBatch(pastBatch))
  while (estimatePromptTokens(prompt) > PROMPT_INPUT_BUDGET && pastBatch.length > 2) {
    // Drop the MIDDLE entry (keeps newest + oldest → preserves timeline spread,
    // the historical depth the re-ground pass actually needs).
    pastBatch = [...pastBatch]
    pastBatch.splice(Math.floor(pastBatch.length / 2), 1)
    // Re-trim the prior against the now-shorter shell.
    const sansPrior2 = assemble('', formatPastBatch(pastBatch))
    priorBlock = hasPrior
      ? `Current page (as prior):\n${budgetPrior(sansPrior2, existingContent.trim())}`
      : 'The page is currently empty — write the first version.'
    prompt = assemble(priorBlock, formatPastBatch(pastBatch))
  }
  return prompt
}
