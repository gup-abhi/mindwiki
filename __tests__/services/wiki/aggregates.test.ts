import { type Entry, listEntriesByEmotion } from '@/services/storage/entries'
import {
  bucketKey,
  countSituations,
  computeMoodTrend,
  distinctRecentExamples,
  buildEmotionAggregate,
  emptyAggregate,
} from '@/services/wiki/aggregates'
import { ok, err } from '@/types/result'

jest.mock('@/services/storage/entries', () => ({
  listEntriesByEmotion: jest.fn(),
}))
const mockList = listEntriesByEmotion as unknown as jest.Mock

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const daysAgo = (n: number) => Date.now() - n * 24 * 60 * 60 * 1000

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: Math.random().toString(36),
  created_at: daysAgo(1),
  mood: 3,
  situation: 'a meeting',
  thought: 'I will fail',
  behavior: null,
  closing_note: null,
  emotion: 'Anxiety',
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
  ...over,
})

describe('bucketKey', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(bucketKey('  A   Big  Meeting ')).toBe('a big meeting')
    expect(bucketKey('A big meeting')).toBe(bucketKey('a  BIG  meeting'))
  })
})

describe('countSituations', () => {
  it('buckets identical situations and sorts by count desc', () => {
    const entries = [
      entry({ situation: 'work deadline' }),
      entry({ situation: 'Work Deadline' }), // same bucket, different case
      entry({ situation: 'social event' }),
    ]
    const res = countSituations(entries)
    expect(res[0]).toEqual({ pattern: 'work deadline', count: 2 })
    expect(res[1]).toEqual({ pattern: 'social event', count: 1 })
  })

  it('skips blank situations and caps at 5', () => {
    const entries = [
      entry({ situation: '   ' }),
      ...Array.from({ length: 8 }, (_, i) => entry({ situation: `sit ${i}` })),
    ]
    const res = countSituations(entries)
    expect(res).toHaveLength(5)
    expect(res.every((s) => s.pattern.startsWith('sit'))).toBe(true)
  })

  it('returns empty for no entries', () => {
    expect(countSituations([])).toEqual([])
  })
})

describe('computeMoodTrend', () => {
  it('reports "up" when recent mood is higher than prior (eased)', () => {
    const entries = [
      entry({ created_at: daysAgo(3), mood: 4 }), // recent window
      entry({ created_at: daysAgo(5), mood: 4 }),
      entry({ created_at: daysAgo(35), mood: 2 }), // prior window (4-8 wks)
      entry({ created_at: daysAgo(40), mood: 2 }),
    ]
    const t = computeMoodTrend(entries)
    expect(t.recentAvg).toBe(4)
    expect(t.priorAvg).toBe(2)
    expect(t.direction).toBe('up')
  })

  it('reports "down" when recent mood is lower (intensifying)', () => {
    const entries = [
      entry({ created_at: daysAgo(3), mood: 2 }),
      entry({ created_at: daysAgo(35), mood: 4 }),
    ]
    expect(computeMoodTrend(entries).direction).toBe('down')
  })

  it('reports "stable" when within the 0.3 band', () => {
    const entries = [
      entry({ created_at: daysAgo(3), mood: 3 }),
      entry({ created_at: daysAgo(35), mood: 3 }),
    ]
    expect(computeMoodTrend(entries).direction).toBe('stable')
  })

  it('reports "insufficient_data" when there is no prior window and no recent', () => {
    expect(computeMoodTrend([]).direction).toBe('insufficient_data')
  })

  it('ignores entries with null mood', () => {
    const entries = [
      entry({ created_at: daysAgo(3), mood: null as unknown as number }),
      entry({ created_at: daysAgo(35), mood: null as unknown as number }),
    ]
    const t = computeMoodTrend(entries)
    expect(t.recentAvg).toBeNull()
    expect(t.priorAvg).toBeNull()
  })
})

describe('distinctRecentExamples', () => {
  it('dedupes by situation and keeps the newest-first order given', () => {
    // Entries arrive newest-first from the query
    const entries = [
      entry({ situation: 'presentation', thought: 'unprepared', created_at: daysAgo(1) }),
      entry({ situation: 'Presentation', thought: 'older dup', created_at: daysAgo(2) }),
      entry({ situation: 'late at night', thought: 'replaying', created_at: daysAgo(3) }),
    ]
    const res = distinctRecentExamples(entries)
    expect(res).toHaveLength(2)
    expect(res[0].situation).toBe('presentation')
    expect(res[0].thought).toBe('unprepared') // first (newest) wins
    expect(res[1].situation).toBe('late at night')
  })

  it('caps at the limit', () => {
    const entries = Array.from({ length: 6 }, (_, i) => entry({ situation: `s${i}` }))
    expect(distinctRecentExamples(entries, 3)).toHaveLength(3)
  })

  it('skips blank situations', () => {
    const entries = [entry({ situation: '  ' }), entry({ situation: 'real' })]
    const res = distinctRecentExamples(entries)
    expect(res).toHaveLength(1)
    expect(res[0].situation).toBe('real')
  })
})

describe('buildEmotionAggregate', () => {
  beforeEach(() => mockList.mockReset())

  it('returns an empty aggregate when the query fails', async () => {
    mockList.mockResolvedValue(err('X', 'boom'))
    const res = await buildEmotionAggregate('Anxiety')
    expect(res.success).toBe(true)
    if (res.success) expect(res.data).toEqual(emptyAggregate('Anxiety'))
  })

  it('assembles counts, recent windows, and top situations', async () => {
    mockList.mockResolvedValue(
      ok([
        entry({ situation: 'work', created_at: daysAgo(2), mood: 2 }),
        entry({ situation: 'work', created_at: daysAgo(10), mood: 2 }),
        entry({ situation: 'home', created_at: daysAgo(40), mood: 3 }),
        entry({ situation: 'old', created_at: daysAgo(70), mood: 3 }), // outside 8wk window
      ])
    )
    const res = await buildEmotionAggregate('Anxiety')
    expect(res.success).toBe(true)
    if (!res.success) return
    const d = res.data
    expect(d.totalCount).toBe(4)
    expect(d.recentCount.last4weeks).toBe(2) // days 2, 10 are within 28d... 10<28 yes
    expect(d.recentCount.last8weeks).toBe(3) // days 2,10,40 within 56d
    expect(d.topSituations[0]).toEqual({ pattern: 'work', count: 2 })
  })
})
