import { moodByDay, monthMoodGrid, detectWeeklyRhythm, detectMomentum } from '@/services/insights/mood-stats'
import { type Entry } from '@/services/storage/entries'

const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime()

const entry = (mood: number, ts: number): Entry => ({
  id: `${ts}-${mood}`,
  created_at: ts,
  mood,
  situation: '',
  thought: '',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  tagged_at: null,
  source: 'journal',
})

// An entry carrying a distortion at a timestamp (mood irrelevant for rhythm).
const entryD = (distortion: string | null, ts: number): Entry => ({ ...entry(3, ts), distortion })

// An entry with arbitrary field overrides, for momentum (mood/tone/depth) tests.
const mk = (ts: number, over: Partial<Entry>): Entry => ({ ...entry(3, ts), ...over })

describe('moodByDay', () => {
  const now = at(2026, 6, 10, 20) // Wed Jun 10 2026

  it('returns one bucket per day, oldest first, with null for empty days', () => {
    const series = moodByDay([], now, 7)
    expect(series).toHaveLength(7)
    expect(series.every((d) => d.avg === null && d.count === 0)).toBe(true)
    // last bucket is today
    expect(series[6].date).toBe(at(2026, 6, 10, 0))
  })

  it('averages multiple entries on the same day', () => {
    const series = moodByDay([entry(2, at(2026, 6, 10, 9)), entry(4, at(2026, 6, 10, 21))], now, 3)
    const today = series[series.length - 1]
    expect(today.count).toBe(2)
    expect(today.avg).toBe(3) // (2 + 4) / 2
  })

  it('ignores entries outside the window', () => {
    const series = moodByDay([entry(5, at(2026, 5, 1))], now, 7) // way before the window
    expect(series.every((d) => d.avg === null)).toBe(true)
  })
})

describe('monthMoodGrid', () => {
  it('lays out a Monday-first grid with leading padding and full final week', () => {
    // June 2026: the 1st is a Monday → no leading padding.
    const weeks = monthMoodGrid([], 2026, 5) // month index 5 = June
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0][0]).toEqual({ day: 1, avg: null })
    const flat = weeks.flat()
    expect(flat.filter((c) => c.day !== null)).toHaveLength(30) // June has 30 days
  })

  it('pads the first week when the month does not start on Monday', () => {
    // May 2026: the 1st is a Friday → Mon..Thu are padding (4 nulls).
    const weeks = monthMoodGrid([], 2026, 4)
    const leadingNulls = weeks[0].filter((c) => c.day === null).length
    expect(leadingNulls).toBe(4)
    expect(weeks[0][4]).toEqual({ day: 1, avg: null })
  })

  it('fills a day with the mean mood of its entries', () => {
    const weeks = monthMoodGrid([entry(3, at(2026, 6, 10)), entry(5, at(2026, 6, 10))], 2026, 5)
    const day10 = weeks.flat().find((c) => c.day === 10)
    expect(day10?.avg).toBe(4) // (3 + 5) / 2
  })
})

describe('detectWeeklyRhythm', () => {
  const now = at(2026, 6, 24, 20) // Wed Jun 24 2026; Jun 3/10/17/24 are Wednesdays

  it('flags a distortion that recurs on the same weekday + time of day', () => {
    const data = [
      entryD('catastrophizing', at(2026, 6, 3, 14)), // Wed afternoon
      entryD('catastrophizing', at(2026, 6, 10, 15)), // Wed afternoon
      entryD('catastrophizing', at(2026, 6, 17, 14)), // Wed afternoon
      entryD('mind reading', at(2026, 6, 4, 10)), // Thu morning — weekday spread
      entryD('mind reading', at(2026, 6, 6, 19)), // Sat evening — weekday spread
      entryD(null, at(2026, 6, 5, 12)), // no distortion — ignored
    ]
    const r = detectWeeklyRhythm(data, now)
    expect(r).not.toBeNull()
    expect(r!.weekday).toBe('Wednesday')
    expect(r!.timeOfDay).toBe('afternoon')
    expect(r!.distortion).toBe('catastrophizing')
    expect(r!.occurrences).toBe(3)
    expect(r!.message).toMatch(/Wednesday afternoons/)
  })

  it('does not flag below the minimum occurrences', () => {
    const data = [
      entryD('catastrophizing', at(2026, 6, 10, 14)), // Wed
      entryD('catastrophizing', at(2026, 6, 17, 14)), // Wed — only 2
      entryD('mind reading', at(2026, 6, 4, 10)), // Thu
      entryD('overgeneralizing', at(2026, 6, 6, 19)), // Sat
    ]
    expect(detectWeeklyRhythm(data, now)).toBeNull()
  })

  it('does not flag a distortion that is spread across the week (low concentration)', () => {
    const data = [
      entryD('catastrophizing', at(2026, 6, 3, 14)), // Wed afternoon
      entryD('catastrophizing', at(2026, 6, 10, 14)), // Wed afternoon
      entryD('catastrophizing', at(2026, 6, 17, 14)), // Wed afternoon → slot = 3
      entryD('catastrophizing', at(2026, 6, 1, 9)), // Mon morning
      entryD('catastrophizing', at(2026, 6, 2, 19)), // Tue evening
      entryD('catastrophizing', at(2026, 6, 4, 10)), // Thu morning
      entryD('catastrophizing', at(2026, 6, 5, 14)), // Fri afternoon
    ]
    // Wed-afternoon is 3 of 7 occurrences (~0.43) — below the 0.5 concentration bar.
    expect(detectWeeklyRhythm(data, now)).toBeNull()
  })

  it('does not mistake journaling on only one weekday for a rhythm', () => {
    const onlyWed = [
      entryD('catastrophizing', at(2026, 6, 3, 14)),
      entryD('catastrophizing', at(2026, 6, 10, 14)),
      entryD('catastrophizing', at(2026, 6, 17, 14)),
      entryD('catastrophizing', at(2026, 6, 24, 14)),
    ]
    expect(detectWeeklyRhythm(onlyWed, now)).toBeNull()
  })

  it('ignores entries older than the lookback window', () => {
    const data = [
      entryD('catastrophizing', at(2026, 4, 22, 14)), // April Wed — outside ~6-week window
      entryD('catastrophizing', at(2026, 6, 10, 14)), // Wed
      entryD('catastrophizing', at(2026, 6, 17, 14)), // Wed → only 2 in window
      entryD('mind reading', at(2026, 6, 4, 10)), // Thu
      entryD('mind reading', at(2026, 6, 6, 19)), // Sat
    ]
    expect(detectWeeklyRhythm(data, now)).toBeNull()
  })
})

describe('detectMomentum', () => {
  const now = at(2026, 6, 24, 20) // recent half ≈ [May 27, Jun 24], earlier ≈ [Apr 29, May 27)
  const earlierDays = [5, 10, 15, 20].map((d) => at(2026, 5, d, 12)) // May (earlier half)
  const recentDays = [1, 8, 15, 22].map((d) => at(2026, 6, d, 12)) // June (recent half)

  it('flags upward momentum when mood and tone both rise', () => {
    const data = [
      ...earlierDays.map((ts) => mk(ts, { mood: 2, mood_score: 0.3 })),
      ...recentDays.map((ts) => mk(ts, { mood: 4, mood_score: 0.6 })),
    ]
    const m = detectMomentum(data, now)
    expect(m).not.toBeNull()
    expect(m!.signals).toEqual(expect.arrayContaining(['mood', 'tone']))
    expect(m!.message).toMatch(/moving/)
  })

  it('flags when a core signal rises with depth corroboration (tone flat)', () => {
    const data = [
      ...earlierDays.map((ts) => mk(ts, { mood: 2, mood_score: 0.5 })),
      ...recentDays.map((ts) =>
        mk(ts, { mood: 4, mood_score: 0.5, behavior: 'did the thing', closing_note: 'a fairer view' })
      ),
    ]
    const m = detectMomentum(data, now)
    expect(m).not.toBeNull()
    expect(m!.signals).toEqual(expect.arrayContaining(['mood', 'depth']))
  })

  it('does not flag a single rising signal (no corroboration)', () => {
    const data = [
      ...earlierDays.map((ts) => mk(ts, { mood: 2, mood_score: 0.5 })),
      ...recentDays.map((ts) => mk(ts, { mood: 4, mood_score: 0.5 })), // only mood moves
    ]
    expect(detectMomentum(data, now)).toBeNull()
  })

  it('never fires on the depth proxy alone', () => {
    const data = [
      ...earlierDays.map((ts) => mk(ts, { mood: 3, mood_score: 0.5 })),
      ...recentDays.map((ts) => mk(ts, { mood: 3, mood_score: 0.5, behavior: 'x', closing_note: 'y' })),
    ]
    expect(detectMomentum(data, now)).toBeNull()
  })

  it('does not flag a decline (up-only)', () => {
    const data = [
      ...earlierDays.map((ts) => mk(ts, { mood: 4, mood_score: 0.6 })),
      ...recentDays.map((ts) => mk(ts, { mood: 2, mood_score: 0.3 })),
    ]
    expect(detectMomentum(data, now)).toBeNull()
  })

  it('does not flag without enough data in each half', () => {
    const data = [
      ...earlierDays.map((ts) => mk(ts, { mood: 2, mood_score: 0.3 })),
      ...recentDays.slice(0, 2).map((ts) => mk(ts, { mood: 4, mood_score: 0.6 })), // only 2 recent
    ]
    expect(detectMomentum(data, now)).toBeNull()
  })
})
