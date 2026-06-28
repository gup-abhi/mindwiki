import { type Entry } from '@/services/storage/entries'

// Pure mood aggregations for the Trends screen — a daily series for the trend
// chart and a month grid for the calendar heatmap. Mood is the user's 1–5
// rating; days with no entry carry a null average.

function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface DayMood {
  /** Local-midnight timestamp of the day. */
  date: number
  /** Mean mood (1–5) of that day's entries, or null if none. */
  avg: number | null
  count: number
}

/**
 * Average mood per day for the last `days` days ending today, oldest first.
 * A day with no entries has avg = null (a gap in the chart).
 */
export function moodByDay(entries: Entry[], now: number, days: number): DayMood[] {
  const buckets = new Map<number, { total: number; count: number }>()
  for (const e of entries) {
    const d = dayStart(e.created_at)
    const b = buckets.get(d) ?? { total: 0, count: 0 }
    b.total += e.mood
    b.count += 1
    buckets.set(d, b)
  }

  const out: DayMood[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i) // DST-safe day stepping
    const date = d.getTime()
    const b = buckets.get(date)
    out.push({ date, avg: b ? b.total / b.count : null, count: b?.count ?? 0 })
  }
  return out
}

export interface MonthCell {
  /** Day-of-month (1–31), or null for padding before/after the month. */
  day: number | null
  avg: number | null
}

/**
 * A Monday-first calendar grid for the given month, as rows of 7 cells. Each
 * real day carries its mean mood (null if no entry); leading/trailing cells are
 * padding (day = null).
 */
export function monthMoodGrid(entries: Entry[], year: number, month: number): MonthCell[][] {
  const byDay = new Map<number, { total: number; count: number }>()
  for (const e of entries) {
    const d = new Date(e.created_at)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate()
      const b = byDay.get(day) ?? { total: 0, count: 0 }
      b.total += e.mood
      b.count += 1
      byDay.set(day, b)
    }
  }

  const startDow = (new Date(year, month, 1).getDay() + 6) % 7 // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: MonthCell[] = []
  for (let i = 0; i < startDow; i++) cells.push({ day: null, avg: null })
  for (let day = 1; day <= daysInMonth; day++) {
    const b = byDay.get(day)
    cells.push({ day, avg: b ? b.total / b.count : null })
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, avg: null })

  const weeks: MonthCell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening'

/** A recurring thought pattern tied to a weekday + time-of-day slot. */
export interface WeeklyRhythm {
  /** Full weekday name, e.g. "Wednesday". */
  weekday: string
  timeOfDay: TimeOfDay
  /** The cognitive distortion that recurs in that slot (lowercased label). */
  distortion: string
  /** How many times it landed in that slot over the lookback. */
  occurrences: number
  /** Observational one-liner. */
  message: string
}

const RHYTHM_LOOKBACK_DAYS = 42 // 6 weeks — enough of each weekday to see a rhythm
const RHYTHM_MIN_OCCURRENCES = 3 // a slot must repeat this often to count
const RHYTHM_CONCENTRATION = 0.5 // ≥ half a distortion's hits must cluster in the slot
const RHYTHM_MIN_WEEKDAYS = 3 // guards "I only ever journal on Wednesdays"

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function timeOfDay(hour: number): TimeOfDay {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/**
 * Find a recurring "weekly spiral": a cognitive distortion that keeps landing in
 * the same weekday + time-of-day slot over the last ~6 weeks — a rhythm you'd
 * never spot from a single week. Returns the strongest such slot, or null when
 * nothing recurs clearly. Deterministic and observational (a pattern in the data,
 * never a diagnosis).
 *
 * Gates: the distortion must hit the slot ≥ RHYTHM_MIN_OCCURRENCES times, those
 * hits must be ≥ RHYTHM_CONCENTRATION of all its occurrences (it clusters here,
 * not everywhere), and journaling must span ≥ RHYTHM_MIN_WEEKDAYS weekdays (so
 * "I only journal Wednesdays" isn't mistaken for a Wednesday pattern).
 */
export function detectWeeklyRhythm(entries: Entry[], now: number): WeeklyRhythm | null {
  const since = now - RHYTHM_LOOKBACK_DAYS * 86_400_000
  const recent = entries.filter(
    (e) =>
      e.created_at >= since &&
      e.created_at <= now &&
      !!e.distortion &&
      e.distortion.toLowerCase() !== 'none'
  )
  if (recent.length === 0) return null

  // Only meaningful if journaling spreads across weekdays — otherwise a slot is
  // "special" only because it's the only day journaled.
  const weekdaysJournaled = new Set(recent.map((e) => new Date(e.created_at).getDay()))
  if (weekdaysJournaled.size < RHYTHM_MIN_WEEKDAYS) return null

  const distortionTotal = new Map<string, number>() // distortion → overall count
  const slotCount = new Map<string, number>() // `${dow}|${tod}|${distortion}` → count
  for (const e of recent) {
    const d = new Date(e.created_at)
    const distortion = e.distortion!.trim().toLowerCase()
    distortionTotal.set(distortion, (distortionTotal.get(distortion) ?? 0) + 1)
    const key = `${d.getDay()}|${timeOfDay(d.getHours())}|${distortion}`
    slotCount.set(key, (slotCount.get(key) ?? 0) + 1)
  }

  // Strongest qualifying slot — most occurrences wins.
  let best: WeeklyRhythm | null = null
  for (const [key, count] of slotCount) {
    if (count < RHYTHM_MIN_OCCURRENCES) continue
    const [dow, tod, distortion] = key.split('|')
    const concentration = count / (distortionTotal.get(distortion) ?? count)
    if (concentration < RHYTHM_CONCENTRATION) continue
    if (best && count <= best.occurrences) continue
    const weekday = WEEKDAYS[Number(dow)]
    best = {
      weekday,
      timeOfDay: tod as TimeOfDay,
      distortion,
      occurrences: count,
      message: `On ${weekday} ${tod}s, ${distortion} thinking keeps surfacing — ${count} times in recent weeks. Worth a closer look?`,
    }
  }
  return best
}

export type MomentumSignal = 'mood' | 'tone' | 'depth'

/** Quiet, longer-arc progress the day-to-day view hides. */
export interface Momentum {
  /** The signals that genuinely rose (for the UI / a future nudge). */
  signals: MomentumSignal[]
  /** Observational one-liner naming only what actually moved. */
  message: string
}

const MOMENTUM_LOOKBACK_DAYS = 56 // 8 weeks — split into two comparable 4-week halves
const MOMENTUM_MIN_HALF_ENTRIES = 4 // each half needs real data to compare
const MOOD_RISE = 0.4 // 1–5 scale
const TONE_RISE = 0.08 // 0–1 inferred mood_score
const DEPTH_RISE = 0.15 // 0–1 share of optional CBT steps filled

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** 0–1: how many of the two optional CBT steps (behavior, closing note) an entry filled. */
function depthOf(e: Entry): number {
  return ((e.behavior?.trim() ? 1 : 0) + (e.closing_note?.trim() ? 1 : 0)) / 2
}

/**
 * Surface forward motion the day-to-day view hides: compare the recent 4 weeks
 * against the prior 4 on the signals we can honestly measure — average mood,
 * the affect the model reads in your language, and how completely you reflect.
 * Up-only and corroborated: it fires only when ≥2 signals rose by a real margin
 * (so it's never a single noisy metric, and the fuzzy depth proxy can never
 * trigger it alone). The message names only what actually moved — never a vague
 * "you're growing." Returns null when there isn't enough data or clear lift.
 */
export function detectMomentum(entries: Entry[], now: number): Momentum | null {
  const day = 86_400_000
  const mid = now - (MOMENTUM_LOOKBACK_DAYS / 2) * day
  const start = now - MOMENTUM_LOOKBACK_DAYS * day
  const earlier = entries.filter((e) => e.created_at >= start && e.created_at < mid)
  const recent = entries.filter((e) => e.created_at >= mid && e.created_at <= now)
  if (earlier.length < MOMENTUM_MIN_HALF_ENTRIES || recent.length < MOMENTUM_MIN_HALF_ENTRIES) return null

  const rose: MomentumSignal[] = []

  // Mood (1–5) — direct.
  if (mean(recent.map((e) => e.mood)) - mean(earlier.map((e) => e.mood)) >= MOOD_RISE) rose.push('mood')

  // Inferred tone (mood_score) — only over entries that carry it, both halves.
  const earlierTone = earlier.map((e) => e.mood_score).filter((x): x is number => x != null)
  const recentTone = recent.map((e) => e.mood_score).filter((x): x is number => x != null)
  if (
    earlierTone.length >= MOMENTUM_MIN_HALF_ENTRIES &&
    recentTone.length >= MOMENTUM_MIN_HALF_ENTRIES &&
    mean(recentTone) - mean(earlierTone) >= TONE_RISE
  ) {
    rose.push('tone')
  }

  // Reflection depth (optional CBT steps filled) — corroboration only.
  if (mean(recent.map(depthOf)) - mean(earlier.map(depthOf)) >= DEPTH_RISE) rose.push('depth')

  // "You're moving" needs corroboration: ≥2 signals. Depth is the only non-core
  // signal, so ≥2 always includes a core mood/tone rise — depth can't fire alone.
  if (rose.length < 2) return null

  const phrase: Record<MomentumSignal, string> = {
    mood: 'your mood has lifted',
    tone: 'your writing reads steadier',
    depth: 'you’re reflecting more fully',
  }
  const parts = rose.map((s) => phrase[s])
  const joined =
    parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

  return {
    signals: rose,
    message: `Day to day it can feel stuck. But over the last several weeks ${joined}. You’re moving — even if you can’t feel it.`,
  }
}
