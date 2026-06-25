const DAY_MS = 86_400_000

/** Local-calendar day index for a timestamp (days since epoch at local midnight). */
export function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

// Manual-freeze model (Duolingo-style). A day "counts" if it has an entry OR the
// user chose to freeze it. Freezes are EARNED — start with one, +1 per 30-day
// streak, capped — and SPENT deliberately (the user taps to save a streak after a
// miss). The earned balance is derived from the day history; the spent days are
// stored (passed in as `frozen`) so the choice survives and syncs across devices.
const STARTER_FREEZES = 1 // granted once, at the very first entry
const FREEZE_EARN_EVERY = 30 // +1 freeze each time the streak reaches a 30-day multiple
const MAX_FREEZES = 3 // cap on how many can be held at once

export interface Streak {
  /** Consecutive kept-days (entry or frozen) up to today; frozen days don't count. */
  current: number
  /** Longest such run ever. */
  longest: number
  /** Freezes the user currently holds (earned − spent), 0..MAX_FREEZES. */
  freezesAvailable: number
}

interface Replay {
  current: number
  longest: number
  freezesAvailable: number
}

/**
 * Replay the day history forward, from the first entry-day to today, over the
 * kept days (entries ∪ the user's frozen days). Each entry-day advances the run
 * and earns a freeze at every 30-day mark (capped). A frozen day keeps the run
 * alive (without advancing its count) and spends one held freeze. An *unfrozen*
 * missed day breaks the run — there's no automatic bridging; the user must have
 * chosen to freeze it. Today is never a miss — the day isn't over. Unspent
 * freezes carry across a break (the user keeps what they earned).
 */
function replay(present: Set<number>, frozen: Set<number>, today: number): Replay {
  if (present.size === 0) return { current: 0, longest: 0, freezesAvailable: 0 }
  const firstDay = Math.min(...present)

  let runLen = 0
  let longest = 0
  let balance = 0
  let started = false

  for (let d = firstDay; d <= today; d++) {
    if (present.has(d)) {
      if (!started) {
        started = true
        balance = STARTER_FREEZES // one-time starter cushion at the first entry
      }
      runLen++
      if (runLen % FREEZE_EARN_EVERY === 0) balance = Math.min(MAX_FREEZES, balance + 1)
      if (runLen > longest) longest = runLen
      continue
    }
    if (runLen === 0) continue // before the first entry or between runs
    if (d === today) continue // today is still open — never a miss
    if (frozen.has(d) && balance > 0) {
      balance-- // a freeze the user spent on this missed day keeps the run alive
    } else {
      runLen = 0 // unfrozen miss → the streak breaks; unspent freezes carry on
    }
  }

  return { current: runLen, longest, freezesAvailable: balance }
}

/**
 * Streak from entry timestamps and the user's chosen frozen days. A day counts if
 * it has an entry or was frozen; an unfrozen missed day breaks the streak. Not
 * writing *today* does not end the streak — the day isn't over.
 */
export function computeStreak(
  timestamps: number[],
  now: number,
  frozenDays: Set<number> = new Set()
): Streak {
  return replay(new Set(timestamps.map(dayIndex)), frozenDays, dayIndex(now))
}

export interface StreakRescue {
  /** True when a missed day has put the streak at risk and held freezes can save it. */
  atRisk: boolean
  /** The streak length that would be preserved by freezing the gap. */
  streakLength: number
  /** The unfrozen missed days that need a freeze, oldest first. */
  daysToFreeze: number[]
  /** How many freezes that costs (one per day). */
  freezesNeeded: number
}

const NO_RESCUE: StreakRescue = { atRisk: false, streakLength: 0, daysToFreeze: [], freezesNeeded: 0 }

/**
 * Whether the user can rescue a streak that a recent miss put at risk. At risk
 * when the last kept day is two or more days back (a real gap, today still open)
 * AND the held freezes cover every unfrozen day in that gap. Returns the gap days
 * to freeze and the streak length that saving them preserves.
 */
export function streakRescue(
  timestamps: number[],
  now: number,
  frozenDays: Set<number> = new Set()
): StreakRescue {
  const present = new Set(timestamps.map(dayIndex))
  if (present.size === 0) return NO_RESCUE
  const today = dayIndex(now)

  const kept = new Set([...present, ...frozenDays])
  let lastKept = -Infinity
  for (const d of kept) if (d < today && d > lastKept) lastKept = d
  // Healthy (kept today or yesterday) or no history before today → nothing to rescue.
  if (lastKept === -Infinity || lastKept >= today - 1) return NO_RESCUE

  // The unfrozen gap days between the last kept day and today (exclusive of today).
  const daysToFreeze: number[] = []
  for (let d = lastKept + 1; d <= today - 1; d++) if (!frozenDays.has(d)) daysToFreeze.push(d)
  if (daysToFreeze.length === 0) return NO_RESCUE

  const { current, freezesAvailable } = replay(present, frozenDays, lastKept)
  if (freezesAvailable < daysToFreeze.length) return NO_RESCUE // can't fully bridge it

  return { atRisk: true, streakLength: current, daysToFreeze, freezesNeeded: daysToFreeze.length }
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
export function weekActivity(
  timestamps: number[],
  now: number,
  frozenDays: Set<number> = new Set()
): DayCell[] {
  const present = new Set(timestamps.map(dayIndex))
  const today = dayIndex(now)

  const dow = (new Date(now).getDay() + 6) % 7 // 0 = Monday
  const mondayIdx = today - dow

  const cells: DayCell[] = []
  for (let i = 0; i < 7; i++) {
    const idx = mondayIdx + i
    let state: DayState
    if (present.has(idx)) state = 'wrote'
    else if (frozenDays.has(idx)) state = 'freeze'
    else if (idx >= today) state = 'future' // today (still open) or upcoming
    else state = 'missed'
    cells.push({ label: WEEK_LABELS[i], state, isToday: idx === today })
  }
  return cells
}
