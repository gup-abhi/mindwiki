import { computeStreak, dayIndex } from './streak'

/**
 * A warm, contextual one-liner for the Home StreakCard, chosen from the days the
 * user has actually journaled — not just the consecutive-streak count. Pure and
 * deterministic from their entry timestamps (so it's testable and never random),
 * it picks the single most relevant message: whether they wrote today, how active
 * the week was, a comeback after a gap, and milestone days.
 */

// Distinct-day totals worth celebrating on the day they're reached.
const MILESTONES = [100, 50, 25, 10]

// A real break (beyond the 1-day grace the streak already bridges): the previous
// active day was at least this many days before today.
const COMEBACK_GAP = 3

export function homeMessage(
  timestamps: number[],
  now: number,
  frozenDays: Set<number> = new Set()
): string {
  const today = dayIndex(now)
  const present = new Set(timestamps.map(dayIndex))
  const totalActiveDays = present.size

  // 1. Brand new — no entries yet.
  if (totalActiveDays === 0) return 'Start your story — write your first entry today.'

  const wroteToday = present.has(today)
  const { current } = computeStreak(timestamps, now, frozenDays)

  // Active days within the last 7 calendar days (inclusive of today).
  let activeThisWeek = 0
  for (let d = today - 6; d <= today; d++) if (present.has(d)) activeThisWeek++

  // Most recent active day strictly before today, for comeback detection.
  let prevActive = -Infinity
  for (const d of present) if (d < today && d > prevActive) prevActive = d
  const cameBackToday =
    wroteToday && prevActive > -Infinity && today - prevActive >= COMEBACK_GAP

  // 2. Milestone reached on a day they wrote.
  if (wroteToday && MILESTONES.includes(totalActiveDays)) {
    return `${totalActiveDays} days journaled — that’s something real. 🌱`
  }

  // 3. Comeback after a real gap, written today.
  if (cameBackToday) return 'Welcome back — that’s today down. Good to have you here again.'

  // 4. Wrote today.
  if (wroteToday) {
    if (current >= 7) return `That’s today done — ${current}-day streak. 🔥`
    return `That’s today written — ${activeThisWeek} ${activeThisWeek === 1 ? 'day' : 'days'} this week. 🌱`
  }

  // 5. Away a while — has history, but no entry today or yesterday.
  if (current === 0) return 'It’s been a little while — today’s a good day to write.'

  // 6. Streak alive, just not written yet today.
  if (current >= 7) return `${current}-day streak going — a few minutes to keep it alive?`
  return `Day ${current} — a moment to write today?`
}
