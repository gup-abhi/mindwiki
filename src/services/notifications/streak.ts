const DAY_MS = 86_400_000

/** Local-calendar day index for a timestamp (days since epoch at local midnight). */
export function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

export interface Streak {
  /** Consecutive entry-days up to today, bridged by grace days. */
  current: number
  /** Longest run of consecutive entry-days ever. */
  longest: number
  /** Whether a grace day is currently propping up the streak. */
  graceUsed: boolean
}

/**
 * The current run, walking backward from today (or yesterday if nothing today
 * yet), bridging single missed days with grace. A grace can't be reused within
 * 7 days of the last — a pause, not a break. Also reports which day indices were
 * bridged, so the week view can mark them as freezes.
 */
function currentRun(
  present: Set<number>,
  today: number
): { current: number; graceUsed: boolean; graceDays: number[] } {
  let cursor = present.has(today) ? today : today - 1
  let current = 0
  let graceUsed = false
  let lastGrace = Infinity
  const graceDays: number[] = []
  while (true) {
    if (present.has(cursor)) {
      current++
      cursor--
      continue
    }
    // Missing day — bridge it with grace if one is available (none used in the
    // last 7 days) and the run actually continues on the far side of the gap.
    if (lastGrace - cursor >= 7 && present.has(cursor - 1)) {
      graceUsed = true
      lastGrace = cursor
      graceDays.push(cursor)
      cursor--
      continue
    }
    break
  }
  return { current, graceUsed, graceDays }
}

/**
 * Streak from entry timestamps. A day counts if it has at least one entry. The
 * current streak survives one missed ("grace") day, but a second grace cannot
 * be used within 7 days of the last — a pause, not a break. Not writing *today*
 * does not end the streak (the day isn't over); the streak is anchored at today
 * if there's an entry today, otherwise at yesterday.
 */
export function computeStreak(timestamps: number[], now: number): Streak {
  if (timestamps.length === 0) return { current: 0, longest: 0, graceUsed: false }

  const present = new Set(timestamps.map(dayIndex))
  const today = dayIndex(now)

  // longest: the longest run of consecutive present days.
  const sorted = Array.from(present).sort((a, b) => a - b)
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1
    if (run > longest) longest = run
  }

  const { current, graceUsed } = currentRun(present, today)
  return { current, longest, graceUsed }
}

/** A single day in the current-week strip. */
export type DayState = 'wrote' | 'freeze' | 'missed' | 'future'
export interface DayCell {
  /** Single-letter weekday label (Mon→Sun). */
  label: string
  state: DayState
  isToday: boolean
}

const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] // Monday-first

/**
 * The current calendar week (Mon→Sun) as day cells for the streak strip: each
 * day is `wrote` (an entry), `freeze` (a missed day the streak bridged),
 * `missed` (a broken day), or `future` (today-not-yet-written or upcoming).
 */
export function weekActivity(timestamps: number[], now: number): DayCell[] {
  const present = new Set(timestamps.map(dayIndex))
  const today = dayIndex(now)
  const graceDays = new Set(currentRun(present, today).graceDays)

  const dow = (new Date(now).getDay() + 6) % 7 // 0 = Monday
  const mondayIdx = today - dow

  const cells: DayCell[] = []
  for (let i = 0; i < 7; i++) {
    const idx = mondayIdx + i
    let state: DayState
    if (present.has(idx)) state = 'wrote'
    else if (graceDays.has(idx)) state = 'freeze'
    else if (idx >= today) state = 'future' // today (still open) or upcoming
    else state = 'missed'
    cells.push({ label: WEEK_LABELS[i], state, isToday: idx === today })
  }
  return cells
}
