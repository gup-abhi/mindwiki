/**
 * Home-screen journey framing from the current streak. Pure so the screen
 * stays presentation-only and the Day 1 / Day 7 / Day 30 copy is unit-tested.
 */
export interface StreakStage {
  variant: 'start' | 'building' | 'week' | 'month'
  headline: string
}

export function streakStage(current: number): StreakStage {
  if (current >= 30) {
    return { variant: 'month', headline: `${current}-day streak — a month of showing up 🔥` }
  }
  if (current >= 7) {
    return { variant: 'week', headline: `${current}-day streak — you’re building a habit` }
  }
  if (current >= 1) {
    return { variant: 'building', headline: `Day ${current} — nice start, keep it going` }
  }
  return { variant: 'start', headline: 'Start a streak — write your first entry today' }
}
