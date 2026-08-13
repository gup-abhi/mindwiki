import { homeMessage } from '@/services/notifications/home-message'

const DAY = 86_400_000
// A fixed "now" at local midday so day math is stable regardless of the run time.
const NOW = new Date(2026, 5, 24, 12, 0, 0).getTime()
// A timestamp N local days before NOW (midday, so it lands squarely in that day).
const daysAgo = (n: number) => NOW - n * DAY

describe('homeMessage', () => {
  it('invites a first entry when there are none', () => {
    expect(homeMessage([], NOW)).toMatch(/write your first entry/i)
  })

  it('celebrates a milestone reached on a day they wrote', () => {
    // 25 distinct days, including today → milestone copy.
    const ts = Array.from({ length: 25 }, (_, i) => daysAgo(i))
    expect(homeMessage(ts, NOW)).toContain('25 days journaled')
  })

  it('welcomes a comeback after a real gap when written today', () => {
    // Wrote today, but the previous entry was 4 days ago (a real break).
    expect(homeMessage([daysAgo(0), daysAgo(4), daysAgo(5)], NOW)).toMatch(/welcome back/i)
  })

  it('acknowledges today on a long streak', () => {
    const ts = Array.from({ length: 8 }, (_, i) => daysAgo(i)) // today + 7 prior
    expect(homeMessage(ts, NOW)).toMatch(/today is recorded — 8 days in a row/i)
  })

  it('keeps today open when the rhythm has not been updated yet', () => {
    const ts = Array.from({ length: 7 }, (_, i) => daysAgo(i + 1))
    expect(homeMessage(ts, NOW)).toMatch(/today is still open/i)
  })

  it('does not frame a longer rhythm as something to keep alive', () => {
    const ts = Array.from({ length: 7 }, (_, i) => daysAgo(i + 1))
    expect(homeMessage(ts, NOW)).not.toMatch(/keep it alive/i)
  })

  it('counts this week when written today on a short rhythm', () => {
    // Today + yesterday only → 2 active days this week, current streak 2.
    expect(homeMessage([daysAgo(0), daysAgo(1)], NOW)).toMatch(/today is recorded — 2 days this week/i)
  })

  it('nudges gently after being away (broken streak, not today)', () => {
    // Last wrote 5 days ago → current streak 0, no entry today/yesterday.
    expect(homeMessage([daysAgo(5), daysAgo(6)], NOW)).toMatch(/no entry today yet/i)
  })

  it('keeps today open when the rhythm is not updated yet', () => {
    // Wrote each of the last 7 days but not today → rhythm remains open today.
    const ts = Array.from({ length: 7 }, (_, i) => daysAgo(i + 1))
    expect(homeMessage(ts, NOW)).toMatch(/today is still open/i)
  })

  it('prompts a Day-N streak when short and not yet written today', () => {
    // Wrote yesterday and the day before, not today → streak 2.
    expect(homeMessage([daysAgo(1), daysAgo(2)], NOW)).toMatch(/^Day 2 is recorded/)
  })
})
