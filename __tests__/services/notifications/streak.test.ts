import { computeStreak, weekActivity } from '@/services/notifications/streak'

// Local-time timestamp helper (month is 1-based here for readability).
const at = (y: number, m: number, d: number, h = 12): number =>
  new Date(y, m - 1, d, h).getTime()

const now = at(2026, 6, 1, 20) // Mon Jun 1 2026, 8pm local

describe('computeStreak', () => {
  it('returns zeros for no entries', () => {
    expect(computeStreak([], now)).toEqual({ current: 0, longest: 0, graceUsed: false })
  })

  it('counts a single entry today', () => {
    expect(computeStreak([at(2026, 6, 1)], now)).toEqual({
      current: 1,
      longest: 1,
      graceUsed: false,
    })
  })

  it('counts consecutive days ending today', () => {
    const ts = [at(2026, 5, 30), at(2026, 5, 31), at(2026, 6, 1)]
    expect(computeStreak(ts, now)).toMatchObject({ current: 3, longest: 3, graceUsed: false })
  })

  it('keeps the streak alive when today has no entry yet (anchors at yesterday)', () => {
    const ts = [at(2026, 5, 30), at(2026, 5, 31)] // nothing on Jun 1
    expect(computeStreak(ts, now)).toMatchObject({ current: 2, graceUsed: false })
  })

  it('bridges a single missed day with a grace day', () => {
    const ts = [at(2026, 5, 30), at(2026, 6, 1)] // May 31 missing
    expect(computeStreak(ts, now)).toMatchObject({ current: 2, graceUsed: true })
  })

  it('breaks on two consecutive missed days', () => {
    const ts = [at(2026, 5, 29), at(2026, 6, 1)] // May 30 + 31 missing
    expect(computeStreak(ts, now)).toMatchObject({ current: 1, graceUsed: false })
  })

  it('does not allow a second grace day within 7 days of the first', () => {
    // Jun 1 present, May 31 gap (grace), May 30 present, May 29 gap (blocked).
    const ts = [at(2026, 5, 28), at(2026, 5, 30), at(2026, 6, 1)]
    expect(computeStreak(ts, now)).toMatchObject({ current: 2, graceUsed: true })
  })

  it('reports the longest past run even when the current streak is shorter', () => {
    // A 4-day run in early May, then only today.
    const ts = [
      at(2026, 5, 10),
      at(2026, 5, 11),
      at(2026, 5, 12),
      at(2026, 5, 13),
      at(2026, 6, 1),
    ]
    expect(computeStreak(ts, now)).toMatchObject({ current: 1, longest: 4 })
  })
})

describe('weekActivity', () => {
  const thu = at(2026, 6, 4, 20) // Thu Jun 4 2026, 8pm — week is Mon Jun 1 → Sun Jun 7
  const states = (cells: ReturnType<typeof weekActivity>) => cells.map((c) => c.state)

  it('labels Monday→Sunday', () => {
    expect(weekActivity([], thu).map((c) => c.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('marks wrote days, a bridged freeze, today-pending and upcoming days', () => {
    // Mon + Tue + Thu written, Wed missed but bridged by grace, Thu is today.
    const ts = [at(2026, 6, 1), at(2026, 6, 2), at(2026, 6, 4)]
    const cells = weekActivity(ts, thu)
    expect(states(cells)).toEqual(['wrote', 'wrote', 'freeze', 'wrote', 'future', 'future', 'future'])
    expect(cells.findIndex((c) => c.isToday)).toBe(3) // Thursday
  })

  it('marks past empty days as missed and today-not-written as future (not missed)', () => {
    // Only today (Thu); Mon–Wed are genuinely missed, Fri–Sun upcoming.
    const cells = weekActivity([at(2026, 6, 4)], thu)
    expect(states(cells)).toEqual(['missed', 'missed', 'missed', 'wrote', 'future', 'future', 'future'])
  })

  it('treats an open today with no entry as future, the prior days as the live streak', () => {
    // Wrote Mon–Wed, nothing yet today (Thu).
    const cells = weekActivity([at(2026, 6, 1), at(2026, 6, 2), at(2026, 6, 3)], thu)
    expect(states(cells)).toEqual(['wrote', 'wrote', 'wrote', 'future', 'future', 'future', 'future'])
    expect(cells[3].isToday).toBe(true)
  })
})
