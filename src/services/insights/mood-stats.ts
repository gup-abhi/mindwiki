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
