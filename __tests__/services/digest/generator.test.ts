import { generateDigest, MIN_ENTRIES_FOR_DIGEST } from '@/services/digest/generator'
import { type Entry } from '@/services/storage/entries'

const now = new Date(2026, 5, 7, 18).getTime() // Sun Jun 7 2026

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: Math.random().toString(36),
  created_at: now,
  mood: 3,
  situation: 's',
  thought: 't',
  behavior: null,
  closing_note: null,
  emotion: 'anxiety',
  distortion: 'catastrophizing',
  mood_score: 0.3,
  tagged_at: 1,
  ...over,
})

// Seven entries spread across the trailing week.
const week = (): Entry[] =>
  Array.from({ length: 7 }, (_, i) =>
    entry({ created_at: new Date(2026, 5, 1 + i, 12).getTime(), mood: 2 + (i % 3) })
  )

describe('generateDigest', () => {
  it('returns null below the entry threshold', () => {
    const few = week().slice(0, MIN_ENTRIES_FOR_DIGEST - 1)
    expect(generateDigest(few, now)).toBeNull()
  })

  it('ignores entries outside the trailing 7-day window', () => {
    const old = entry({ created_at: new Date(2026, 4, 1, 12).getTime() }) // ~5 weeks ago
    expect(generateDigest([old, ...week().slice(0, 6)], now)).toBeNull() // only 6 in-window
  })

  it('populates all six sections with enough entries', () => {
    const d = generateDigest(week(), now)
    expect(d).not.toBeNull()
    expect(d!.moodArc.length).toBeGreaterThan(0)
    expect(d!.observations.length).toBeGreaterThan(0)
    expect(d!.pattern.length).toBeGreaterThan(0)
    expect(d!.correlation.length).toBeGreaterThan(0)
    expect(d!.question.length).toBeGreaterThan(0)
    expect(d!.quote.length).toBeGreaterThan(0)
    expect(d!.entryCount).toBe(7)
  })

  it('builds the mood arc as one averaged point per day, in order', () => {
    const d = generateDigest(week(), now)!
    expect(d.moodArc).toHaveLength(7) // 7 distinct days
    const days = d.moodArc.map((p) => p.day)
    expect(days).toEqual([...days].sort((a, b) => a - b))
    expect(d.moodArc.every((p) => p.mood >= 1 && p.mood <= 5)).toBe(true)
  })

  it('surfaces the dominant emotion in observations and pattern', () => {
    // 7 entries all "anxiety" + "none" distortion -> emotion drives the pattern
    const d = generateDigest(
      week().map((e) => ({ ...e, emotion: 'anxiety', distortion: 'none' })),
      now
    )!
    expect(d.observations.some((o) => /Anxiety came up most/.test(o))).toBe(true)
    expect(d.pattern).toMatch(/Anxiety/)
  })
})
