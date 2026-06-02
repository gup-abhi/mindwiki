const DAY_MS = 86_400_000

/** Local-calendar day index for a timestamp (days since epoch at local midnight). */
function dayIndex(ts: number): number {
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

  // current: walk backward from today (or yesterday if nothing today yet),
  // bridging single missed days with grace.
  let cursor = present.has(today) ? today : today - 1
  let current = 0
  let graceUsed = false
  let lastGrace = Infinity
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
      cursor--
      continue
    }
    break
  }

  return { current, longest, graceUsed }
}
