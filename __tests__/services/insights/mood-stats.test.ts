import { moodByDay, monthMoodGrid } from '@/services/insights/mood-stats'
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
  distortion: null,
  mood_score: null,
  topic: null,
  tagged_at: null,
  source: 'journal',
})

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
