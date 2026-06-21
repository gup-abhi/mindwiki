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
  topic: null,
  tagged_at: 1,
  source: 'journal',
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

  it('populates every dashboard field with enough entries', () => {
    const d = generateDigest(week(), now)
    expect(d).not.toBeNull()
    expect(d!.moodArc.length).toBeGreaterThan(0)
    expect(d!.emotionMix.length).toBeGreaterThan(0)
    expect(d!.avgMood).toBeGreaterThan(0)
    expect(d!.dayCount).toBe(7)
    expect(d!.pattern.length).toBeGreaterThan(0)
    expect(d!.correlation.length).toBeGreaterThan(0)
    expect(d!.question.length).toBeGreaterThan(0)
    expect(d!.quote.length).toBeGreaterThan(0)
    expect(d!.entryCount).toBe(7)
  })

  it('has no mood delta without prior-week entries, and a signed delta with them', () => {
    expect(generateDigest(week(), now)!.moodDelta).toBeNull()

    // Prior week all mood 1; this week averages > 1 -> positive delta.
    const prior = Array.from({ length: 3 }, (_, i) =>
      entry({ created_at: new Date(2026, 4, 26 + i, 12).getTime(), mood: 1 })
    )
    const d = generateDigest([...prior, ...week()], now)!
    expect(d.moodDelta).not.toBeNull()
    expect(d.moodDelta!).toBeGreaterThan(0)
  })

  it('calls out the brightest and toughest day when moods differ', () => {
    const d = generateDigest(week(), now)! // week() moods vary by day
    expect(d.brightest).not.toBeNull()
    expect(d.toughest).not.toBeNull()
    expect(d.brightest!.mood).toBeGreaterThan(d.toughest!.mood)
    expect(typeof d.brightest!.weekday).toBe('string')
  })

  it('omits brightest/toughest when every day has the same mood', () => {
    const flat = week().map((e) => ({ ...e, mood: 3 }))
    const d = generateDigest(flat, now)!
    expect(d.brightest).toBeNull()
    expect(d.toughest).toBeNull()
  })

  it('builds the mood arc as one averaged point per day, in order', () => {
    const d = generateDigest(week(), now)!
    expect(d.moodArc).toHaveLength(7) // 7 distinct days
    const days = d.moodArc.map((p) => p.day)
    expect(days).toEqual([...days].sort((a, b) => a - b))
    expect(d.moodArc.every((p) => p.mood >= 1 && p.mood <= 5)).toBe(true)
  })

  it('surfaces the dominant emotion in the mix and pattern', () => {
    // 7 entries all "anxiety" + "none" distortion -> emotion drives the pattern
    const d = generateDigest(
      week().map((e) => ({ ...e, emotion: 'anxiety', distortion: 'none' })),
      now
    )!
    expect(d.emotionMix[0]).toEqual({ label: 'anxiety', count: 7 })
    expect(d.pattern).toMatch(/Anxiety/)
  })
})
