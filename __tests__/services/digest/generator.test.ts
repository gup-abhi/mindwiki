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
  named_emotion: null,
  energy: null,
  distortion: 'catastrophizing',
  mood_score: 0.3,
  topic: null,
  topic2: null,
  tagged_at: 1,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
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

  describe('mood blind spot', () => {
    it('flags it when upbeat ratings hide a low inferred score, and names the feeling', () => {
      // 4 distinct days rated high (mood 5) but read low (score 0.2) with frustration.
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 5, mood_score: 0.2, emotion: 'frustration' }
          : { ...e, mood: 3, mood_score: 0.6, emotion: 'calm' }
      )
      const d = generateDigest(days, now)!
      expect(d.moodBlindSpot).not.toBeNull()
      expect(d.moodBlindSpot!.days).toBe(4)
      expect(d.moodBlindSpot!.emotion).toBe('frustration')
      expect(d.moodBlindSpot!.message).toMatch(/frustration/)
    })

    it('does not flag when high ratings agree with a high inferred score', () => {
      const days = week().map((e) => ({ ...e, mood: 5, mood_score: 0.85 }))
      expect(generateDigest(days, now)!.moodBlindSpot).toBeNull()
    })

    it('does not flag a one-off divergence below the day threshold', () => {
      const days = week().map((e, i) =>
        i < 2 ? { ...e, mood: 5, mood_score: 0.2 } : { ...e, mood: 3, mood_score: 0.6 }
      )
      expect(generateDigest(days, now)!.moodBlindSpot).toBeNull()
    })

    it('ignores entries with no inferred score (untagged)', () => {
      const days = week().map((e) => ({ ...e, mood: 5, mood_score: null }))
      expect(generateDigest(days, now)!.moodBlindSpot).toBeNull()
    })

    it('uses a generic message when the divergent days carry no tagged feeling', () => {
      const days = week().map((e, i) =>
        i < 3 ? { ...e, mood: 5, mood_score: 0.2, emotion: null } : { ...e, mood: 3, mood_score: 0.6 }
      )
      const d = generateDigest(days, now)!
      expect(d.moodBlindSpot).not.toBeNull()
      expect(d.moodBlindSpot!.emotion).toBeNull()
      expect(d.moodBlindSpot!.message).toMatch(/your words read lower/)
    })
  })

  describe('self-criticism blind spot (inverse)', () => {
    it('flags it when low ratings read lighter than you felt', () => {
      // 3 distinct days rated low (mood 1) but read light (score 0.8).
      const days = week().map((e, i) =>
        i < 3 ? { ...e, mood: 1, mood_score: 0.8 } : { ...e, mood: 4, mood_score: 0.5 }
      )
      const d = generateDigest(days, now)!
      expect(d.selfCriticism).not.toBeNull()
      expect(d.selfCriticism!.days).toBe(3)
      expect(d.selfCriticism!.message).toMatch(/harder on yourself/)
    })

    it('does not flag when low ratings agree with a low inferred score', () => {
      const days = week().map((e) => ({ ...e, mood: 1, mood_score: 0.2 }))
      expect(generateDigest(days, now)!.selfCriticism).toBeNull()
    })

    it('surfaces both gaps independently in the same week', () => {
      const days = [
        ...Array.from({ length: 3 }, (_, i) =>
          entry({ created_at: new Date(2026, 5, 1 + i, 12).getTime(), mood: 5, mood_score: 0.2, emotion: 'frustration' })
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          entry({ created_at: new Date(2026, 5, 4 + i, 12).getTime(), mood: 1, mood_score: 0.8 })
        ),
        entry({ created_at: new Date(2026, 5, 7, 12).getTime(), mood: 3, mood_score: 0.5 }),
      ]
      const d = generateDigest(days, now)!
      expect(d.moodBlindSpot).not.toBeNull()
      expect(d.selfCriticism).not.toBeNull()
    })
  })

  describe('emotion disguise (named feeling vs the model read)', () => {
    it('flags it when a neutral/upbeat named feeling reads negative, naming both words', () => {
      // 4 distinct days: named "Hopeful" but the language reads "anxiety".
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 4, mood_score: 0.2, named_emotion: 'Hopeful', emotion: 'anxiety' }
          : { ...e, mood: 4, mood_score: 0.7, named_emotion: 'Content', emotion: 'calm' }
      )
      const d = generateDigest(days, now)!
      expect(d.emotionDisguise).not.toBeNull()
      expect(d.emotionDisguise!.days).toBe(4)
      expect(d.emotionDisguise!.named).toBe('Hopeful') // capital restored
      expect(d.emotionDisguise!.inferred).toBe('anxiety')
      expect(d.emotionDisguise!.message).toMatch(/Hopeful/)
      expect(d.emotionDisguise!.message).toMatch(/anxiety/)
    })

    it('does not flag below the day threshold', () => {
      const days = week().map((e, i) =>
        i < 2
          ? { ...e, mood: 4, mood_score: 0.2, named_emotion: 'Hopeful', emotion: 'anxiety' }
          : { ...e, mood: 3, mood_score: 0.7, named_emotion: 'Calm', emotion: 'calm' }
      )
      expect(generateDigest(days, now)!.emotionDisguise).toBeNull()
    })

    it('does not flag when the named word matches the model read (no real mismatch)', () => {
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 4, mood_score: 0.2, named_emotion: 'Anxiety', emotion: 'anxiety' }
          : { ...e, mood: 3, mood_score: 0.7 }
      )
      expect(generateDigest(days, now)!.emotionDisguise).toBeNull()
    })

    it('does not flag when the user already named it a low mood (not a disguise)', () => {
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 2, mood_score: 0.2, named_emotion: 'Sad', emotion: 'anxiety' }
          : { ...e, mood: 3, mood_score: 0.7 }
      )
      expect(generateDigest(days, now)!.emotionDisguise).toBeNull()
    })

    it('only triggers on entries that carry a user-named feeling — older entries do not', () => {
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 4, mood_score: 0.2, named_emotion: null, emotion: 'anxiety' }
          : { ...e, mood: 3, mood_score: 0.7 }
      )
      const d = generateDigest(days, now)!
      expect(d.emotionDisguise).toBeNull()
      expect(d.moodBlindSpot).not.toBeNull() // the mood-number version still fires (suppressed only in the UI)
    })
  })

  describe('emotion undersell (heavy named feeling, lighter read)', () => {
    it('flags it when a heavy named feeling reads lighter, naming both words', () => {
      // 4 distinct days: named "Sad" but the language reads "calm".
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 1, mood_score: 0.8, named_emotion: 'Sad', emotion: 'calm' }
          : { ...e, mood: 4, mood_score: 0.5, named_emotion: 'Content', emotion: 'content' }
      )
      const d = generateDigest(days, now)!
      expect(d.emotionUndersell).not.toBeNull()
      expect(d.emotionUndersell!.days).toBe(4)
      expect(d.emotionUndersell!.named).toBe('Sad')
      expect(d.emotionUndersell!.inferred).toBe('calm')
      expect(d.emotionUndersell!.message).toMatch(/Sad/)
      expect(d.emotionUndersell!.message).toMatch(/calm/)
    })

    it('does not flag below the day threshold', () => {
      const days = week().map((e, i) =>
        i < 2
          ? { ...e, mood: 1, mood_score: 0.8, named_emotion: 'Sad', emotion: 'calm' }
          : { ...e, mood: 4, mood_score: 0.5 }
      )
      expect(generateDigest(days, now)!.emotionUndersell).toBeNull()
    })

    it('does not flag when the named word matches the model read', () => {
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 1, mood_score: 0.8, named_emotion: 'Calm', emotion: 'calm' }
          : { ...e, mood: 4, mood_score: 0.5 }
      )
      expect(generateDigest(days, now)!.emotionUndersell).toBeNull()
    })

    it('does not flag when the language also reads heavy (agrees with the label)', () => {
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 1, mood_score: 0.2, named_emotion: 'Sad', emotion: 'sadness' }
          : { ...e, mood: 4, mood_score: 0.5 }
      )
      expect(generateDigest(days, now)!.emotionUndersell).toBeNull()
    })

    it('only triggers on entries that carry a user-named feeling — older entries do not', () => {
      const days = week().map((e, i) =>
        i < 4
          ? { ...e, mood: 1, mood_score: 0.8, named_emotion: null, emotion: 'calm' }
          : { ...e, mood: 4, mood_score: 0.5 }
      )
      const d = generateDigest(days, now)!
      expect(d.emotionUndersell).toBeNull()
      expect(d.selfCriticism).not.toBeNull() // the mood-number version still fires (suppressed only in the UI)
    })
  })
})
