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
