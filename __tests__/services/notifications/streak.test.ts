import { computeStreak, dayIndex, streakRescue, weekActivity } from '@/services/notifications/streak'

// Local-time timestamp helper (month is 1-based here for readability).
const at = (y: number, m: number, d: number, h = 12): number =>
  new Date(y, m - 1, d, h).getTime()

const now = at(2026, 6, 1, 20) // Mon Jun 1 2026, 8pm local

// N consecutive entry-days ending at `end` (inclusive).
const run = (end: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => end - i * 86_400_000)

// A frozen-day set from timestamps (the day index of each).
const frozen = (...ts: number[]) => new Set(ts.map(dayIndex))

describe('computeStreak — manual freezes', () => {
  it('returns zeros for no entries', () => {
    expect(computeStreak([], now)).toEqual({ current: 0, longest: 0, freezesAvailable: 0 })
  })

  it('grants the starter freeze at the first entry', () => {
    expect(computeStreak([at(2026, 6, 1)], now)).toEqual({
      current: 1,
      longest: 1,
      freezesAvailable: 1,
    })
  })

  it('counts consecutive days ending today, holding the starter freeze', () => {
    const ts = [at(2026, 5, 30), at(2026, 5, 31), at(2026, 6, 1)]
    expect(computeStreak(ts, now)).toEqual({ current: 3, longest: 3, freezesAvailable: 1 })
  })

  it('BREAKS on an unfrozen missed day — no automatic bridging', () => {
    const ts = [at(2026, 5, 30), at(2026, 6, 1)] // May 31 missed, not frozen
    expect(computeStreak(ts, now)).toMatchObject({ current: 1, freezesAvailable: 1 })
  })

  it('keeps the streak when the missed day is frozen, spending one freeze', () => {
    const ts = [at(2026, 5, 30), at(2026, 6, 1)] // May 31 frozen by the user
    expect(computeStreak(ts, now, frozen(at(2026, 5, 31)))).toMatchObject({
      current: 2,
      freezesAvailable: 0,
    })
  })

  it('earns a freeze at a 30-day streak, capped at 3 by 90', () => {
    expect(computeStreak(run(now, 30), now)).toMatchObject({ current: 30, freezesAvailable: 2 })
    expect(computeStreak(run(now, 90), now)).toMatchObject({ current: 90, freezesAvailable: 3 })
  })

  it('carries unspent freezes across a break (the user keeps what they earned)', () => {
    // 30-day run ending May 30 earns a 2nd freeze, then May 31 is missed (unfrozen)
    // so the streak breaks — but both freezes survive into the new run today.
    const ts = [...run(at(2026, 5, 30), 30), at(2026, 6, 1)]
    expect(computeStreak(ts, now)).toMatchObject({ current: 1, freezesAvailable: 2 })
  })
})

describe('streakRescue', () => {
  it('is not at risk when yesterday was kept (today still open)', () => {
    expect(streakRescue([at(2026, 5, 31)], now).atRisk).toBe(false)
  })

  it('offers to save a streak after a single missed day', () => {
    // Wrote May 29–30 (2-day streak), missed May 31, today (Jun 1) open.
    const r = streakRescue([at(2026, 5, 29), at(2026, 5, 30)], now)
    expect(r.atRisk).toBe(true)
    expect(r.streakLength).toBe(2)
    expect(r.freezesNeeded).toBe(1)
    expect(r.daysToFreeze).toEqual([dayIndex(at(2026, 5, 31))])
  })

  it('bridges a two-day gap when enough freezes are held', () => {
    // A 30-day run ending May 29 holds 2 freezes; May 30 + 31 missed.
    const r = streakRescue(run(at(2026, 5, 29), 30), now)
    expect(r.atRisk).toBe(true)
    expect(r.streakLength).toBe(30)
    expect(r.freezesNeeded).toBe(2)
    expect(r.daysToFreeze).toEqual([dayIndex(at(2026, 5, 30)), dayIndex(at(2026, 5, 31))])
  })

  it('is not at risk when the gap exceeds the held freezes', () => {
    // 2-day streak (1 starter freeze), but two days missed → can't fully bridge.
    expect(streakRescue([at(2026, 5, 28), at(2026, 5, 29)], now).atRisk).toBe(false)
  })

  it('ignores days the user already froze in the gap', () => {
    // Missed May 30 + 31; May 30 already frozen, so only May 31 needs a freeze.
    const r = streakRescue(run(at(2026, 5, 29), 30), now, frozen(at(2026, 5, 30)))
    expect(r.atRisk).toBe(true)
    expect(r.daysToFreeze).toEqual([dayIndex(at(2026, 5, 31))])
  })
})

describe('weekActivity', () => {
  const thu = at(2026, 6, 4, 20) // Thu Jun 4 2026, 8pm — week is Mon Jun 1 → Sun Jun 7
  const states = (cells: ReturnType<typeof weekActivity>) => cells.map((c) => c.state)

  it('labels Monday→Sunday', () => {
    expect(weekActivity([], thu).map((c) => c.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('marks wrote days, a frozen day, today-pending and upcoming days', () => {
    // Mon + Tue + Thu written, Wed missed but frozen by the user, Thu is today.
    const ts = [at(2026, 6, 1), at(2026, 6, 2), at(2026, 6, 4)]
    const cells = weekActivity(ts, thu, frozen(at(2026, 6, 3)))
    expect(states(cells)).toEqual(['wrote', 'wrote', 'freeze', 'wrote', 'future', 'future', 'future'])
    expect(cells.findIndex((c) => c.isToday)).toBe(3) // Thursday
  })

  it('marks an unfrozen past empty day as missed', () => {
    // Mon + Tue + Thu written, Wed missed and NOT frozen → missed (no auto-freeze).
    const ts = [at(2026, 6, 1), at(2026, 6, 2), at(2026, 6, 4)]
    expect(states(weekActivity(ts, thu))).toEqual([
      'wrote', 'wrote', 'missed', 'wrote', 'future', 'future', 'future',
    ])
  })

  it('treats an open today with no entry as future, the prior days as the live streak', () => {
    const cells = weekActivity([at(2026, 6, 1), at(2026, 6, 2), at(2026, 6, 3)], thu)
    expect(states(cells)).toEqual(['wrote', 'wrote', 'wrote', 'future', 'future', 'future', 'future'])
    expect(cells[3].isToday).toBe(true)
  })
})
