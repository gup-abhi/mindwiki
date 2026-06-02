import { type Entry } from '@/services/storage/entries'

const DAY_MS = 86_400_000

/** A digest is only generated once the week has enough entries to be meaningful. */
export const MIN_ENTRIES_FOR_DIGEST = 7

function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Most frequent value (case-insensitive), with its count; null for an empty list. */
function mostCommon(values: string[]): { label: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const v of values) {
    const k = v.trim().toLowerCase()
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: { label: string; count: number } | null = null
  for (const [label, count] of counts) {
    if (!best || count > best.count) best = { label, count }
  }
  return best
}

export interface MoodPoint {
  /** Local-calendar day index. */
  day: number
  /** Average self-reported mood (1–5) for that day. */
  mood: number
}

export interface Digest {
  weekStart: number
  weekEnd: number
  entryCount: number
  moodArc: MoodPoint[]
  observations: string[]
  pattern: string
  correlation: string
  question: string
  quote: string
}

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
  const distortions = entries
    .map((e) => e.distortion)
    .filter((x): x is string => !!x && x.toLowerCase() !== 'none')
  const topEmotion = mostCommon(emotions)
  const topDistortion = mostCommon(distortions)

  const observations: string[] = [
    `${entries.length} entries across ${byDay.size} ${byDay.size === 1 ? 'day' : 'days'}.`,
    `Your average mood was ${avgMood.toFixed(1)} out of 5.`,
  ]
  if (topEmotion) {
    observations.push(
      `${cap(topEmotion.label)} came up most — ${topEmotion.count} ${
        topEmotion.count === 1 ? 'time' : 'times'
      }.`
    )
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
    moodArc,
    observations,
    pattern,
    correlation,
    question,
    quote,
  }
}
