import { type Entry } from '@/services/storage/entries'
import { detectWeeklyRhythm, type WeeklyRhythm } from '@/services/insights/mood-stats'

const DAY_MS = 86_400_000

/** A digest is only generated once the week has enough entries to be meaningful. */
export const MIN_ENTRIES_FOR_DIGEST = 7

function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Tally values (case-insensitive), most frequent first. */
function tally(values: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    const k = v.trim().toLowerCase()
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

/** Most frequent value (case-insensitive), with its count; null for an empty list. */
function mostCommon(values: string[]): { label: string; count: number } | null {
  return tally(values)[0] ?? null
}

export interface MoodPoint {
  /** Local-calendar day index. */
  day: number
  /** Average self-reported mood (1–5) for that day. */
  mood: number
}

/** A single bar in the emotion mix — a feeling and how often it came up. */
export interface EmotionSlice {
  label: string
  count: number
}

/** The brightest / toughest day of the week, for the callout line. */
export interface DayExtreme {
  /** Local-calendar day index (matches MoodPoint.day). */
  day: number
  mood: number
  /** Short weekday name, e.g. "Thu". */
  weekday: string
}

/**
 * A "mood gap": days where the mood you consciously picked and the one the model
 * inferred from your language diverge — in either direction (rated up but read
 * low, or rated down but read lighter). Observational only (it surfaces a pattern
 * in your own data); never a diagnosis. Null when there's no clear, repeated gap.
 */
export interface MoodBlindSpot {
  /** Distinct days the gap showed up on. */
  days: number
  /** The feeling that recurred on those days (lowercased), or null if none tagged. */
  emotion: string | null
  /** Observational one-liner for the digest. */
  message: string
}

/** Multi-agent synthesis added on top of the deterministic sections (optional). */
export interface DigestSynthesisResult {
  themes: string[]
  patterns: string[]
  openQuestions: string[]
  /** Claims the critic dropped for lack of supporting entries. */
  flaggedClaims: string[]
}

export interface Digest {
  weekStart: number
  weekEnd: number
  entryCount: number
  /** Distinct days journaled this week. */
  dayCount: number
  avgMood: number
  /** Change in average mood vs the prior 7 days; null when there's no prior data. */
  moodDelta: number | null
  moodArc: MoodPoint[]
  /** Feelings this week, most frequent first. */
  emotionMix: EmotionSlice[]
  /** Highest / lowest mood day; null when there isn't enough contrast (≤1 day or flat). */
  brightest: DayExtreme | null
  toughest: DayExtreme | null
  pattern: string
  correlation: string
  /** Days rated upbeat whose language read low; null when there's no clear gap. */
  moodBlindSpot: MoodBlindSpot | null
  /** Days rated low whose language read lighter than you felt; null when none. */
  selfCriticism: MoodBlindSpot | null
  /** A distortion recurring on the same weekday+time over recent weeks; null when none. */
  weeklyRhythm: WeeklyRhythm | null
  question: string
  quote: string
  /** LLM-synthesized themes/patterns/questions (added best-effort, post-generate). */
  synthesis?: DigestSynthesisResult
}

// Mood gap thresholds. Self-mood is 1–5; the model's inferred mood_score is 0–1.
// A gap is only surfaced when it recurs across at least MIN_GAP_DAYS distinct days.
const MIN_GAP_DAYS = 3
// "Disguise": rated upbeat, but the language read low.
const DISGUISE_MOOD_MIN = 4
const DISGUISE_SCORE_MAX = 0.4
// "Undersold": rated low, but the language read lighter than you felt.
const UNDERSELL_MOOD_MAX = 2
const UNDERSELL_SCORE_MIN = 0.6

/**
 * Distinct-day count + the feeling that recurs, for the entries matching `match`
 * — or null when the gap doesn't repeat across enough days. Shared by both
 * mood-gap directions so they stay symmetric. `match` must guard mood_score null.
 */
function moodGap(
  entries: Entry[],
  match: (e: Entry) => boolean
): { days: number; emotion: string | null } | null {
  const hits = entries.filter(match)
  const days = new Set(hits.map((e) => dayIndex(e.created_at)))
  if (days.size < MIN_GAP_DAYS) return null
  const feeling = mostCommon(hits.map((e) => e.emotion).filter((x): x is string => !!x))
  return { days: days.size, emotion: feeling?.label ?? null }
}

const weekdayOf = (day: number): string =>
  new Date(day * DAY_MS).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })

// Curated, non-clinical reflective lines. Rotated weekly. Never implies
// diagnosis or treatment.
const QUOTES: readonly string[] = [
  'Noticing a feeling is the first step to understanding it.',
  'You showed up for yourself this week. That counts.',
  'Patterns aren’t verdicts — they’re information.',
  'Small, honest notes add up to a clearer picture.',
  'Being curious about your thoughts is its own kind of kindness.',
  'A hard week is data, not a definition.',
  'What you pay attention to, you start to understand.',
  'Progress is rarely a straight line — and that’s fine.',
]

/**
 * Compile the weekly digest from entries in the trailing 7 days. Returns null
 * when there aren't enough entries yet. All six sections are always populated
 * when a digest is returned. Pure — no storage, no network, no LLM (the
 * reflection question is a template the LLM layer may later replace).
 */
export function generateDigest(allEntries: Entry[], now: number): Digest | null {
  const weekEnd = now
  const weekStart = now - 7 * DAY_MS
  const entries = allEntries.filter((e) => e.created_at >= weekStart && e.created_at <= weekEnd)
  if (entries.length < MIN_ENTRIES_FOR_DIGEST) return null

  // Mood arc — average self-reported mood per day.
  const byDay = new Map<number, number[]>()
  for (const e of entries) {
    const d = dayIndex(e.created_at)
    byDay.set(d, [...(byDay.get(d) ?? []), e.mood])
  }
  const moodArc: MoodPoint[] = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, moods]) => ({ day, mood: avg(moods) }))

  const avgMood = avg(entries.map((e) => e.mood))
  const emotions = entries.map((e) => e.emotion).filter((x): x is string => !!x)
  const emotionMix = tally(emotions)
  const distortions = entries
    .map((e) => e.distortion)
    .filter((x): x is string => !!x && x.toLowerCase() !== 'none')
  const topEmotion = emotionMix[0] ?? null
  const topDistortion = mostCommon(distortions)

  // Week-over-week mood delta — average of the prior 7 days, if any entries exist.
  const priorStart = weekStart - 7 * DAY_MS
  const priorMoods = allEntries
    .filter((e) => e.created_at >= priorStart && e.created_at < weekStart)
    .map((e) => e.mood)
  const moodDelta = priorMoods.length ? avgMood - avg(priorMoods) : null

  // Brightest / toughest day — only when there's real contrast across ≥2 days.
  let brightest: DayExtreme | null = null
  let toughest: DayExtreme | null = null
  if (moodArc.length >= 2) {
    const hi = moodArc.reduce((a, b) => (b.mood > a.mood ? b : a))
    const lo = moodArc.reduce((a, b) => (b.mood < a.mood ? b : a))
    if (hi.mood > lo.mood) {
      brightest = { day: hi.day, mood: hi.mood, weekday: weekdayOf(hi.day) }
      toughest = { day: lo.day, mood: lo.mood, weekday: weekdayOf(lo.day) }
    }
  }

  const pattern = topDistortion
    ? `You leaned toward ${topDistortion.label} thinking (${topDistortion.count}×).`
    : topEmotion
      ? `${cap(topEmotion.label)} was your most frequent emotion.`
      : 'A varied week with no single dominant pattern.'

  // Correlation — the emotion most present on lower-mood entries.
  const lowThreshold = Math.min(avgMood, 3)
  const lowMoodEmotions = entries
    .filter((e) => e.mood <= lowThreshold && e.emotion)
    .map((e) => e.emotion as string)
  const lowEmotion = mostCommon(lowMoodEmotions)
  const correlation = lowEmotion
    ? `Your tougher days often carried ${lowEmotion.label}.`
    : 'No clear link between mood dips and any one feeling this week.'

  // Mood gaps — where your self-rating and the model's read of your language
  // diverge, repeated across ≥ MIN_GAP_DAYS days. Both observational only.

  // Disguise: rated upbeat (≥4) but read low (≤0.4) — names the recurring feeling.
  const disguise = moodGap(
    entries,
    (e) => e.mood >= DISGUISE_MOOD_MIN && e.mood_score != null && e.mood_score <= DISGUISE_SCORE_MAX
  )
  const moodBlindSpot: MoodBlindSpot | null = disguise && {
    days: disguise.days,
    emotion: disguise.emotion,
    message: disguise.emotion
      ? `On ${disguise.days} days you rated your mood high, but ${disguise.emotion} kept surfacing in what you wrote. Worth a second look?`
      : `On ${disguise.days} days you rated your mood high, but your words read lower. Worth a second look?`,
  }

  // Undersold: rated low (≤2) but read lighter (≥0.6) — the self-criticism gap.
  // Deliberately gentle and emotion-free; naming a negative feeling here would
  // clash with "your words read lighter".
  const undersell = moodGap(
    entries,
    (e) => e.mood <= UNDERSELL_MOOD_MAX && e.mood_score != null && e.mood_score >= UNDERSELL_SCORE_MIN
  )
  const selfCriticism: MoodBlindSpot | null = undersell && {
    days: undersell.days,
    emotion: undersell.emotion,
    message: `On ${undersell.days} days you rated your mood low, but your words read lighter than you felt. You may be harder on yourself than your day warranted.`,
  }

  // Weekly rhythm — a distortion recurring on the same weekday+time across the
  // last ~6 weeks. Runs over ALL entries (not just this week), since a "every
  // Wednesday" pattern is invisible inside a single 7-day window.
  const weeklyRhythm = detectWeeklyRhythm(allEntries, now)

  const focus = topDistortion?.label ?? topEmotion?.label
  const question = focus
    ? `When ${focus} showed up this week, what was usually going on around you?`
    : 'Looking back on this week, what stands out to you?'

  const weekNo = Math.floor(weekStart / (7 * DAY_MS))
  const quote = QUOTES[((weekNo % QUOTES.length) + QUOTES.length) % QUOTES.length]

  return {
    weekStart,
    weekEnd,
    entryCount: entries.length,
    dayCount: byDay.size,
    avgMood,
    moodDelta,
    moodArc,
    emotionMix,
    brightest,
    toughest,
    pattern,
    correlation,
    moodBlindSpot,
    selfCriticism,
    weeklyRhythm,
    question,
    quote,
  }
}
