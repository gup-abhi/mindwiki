import { computePageTrend, computeTrendingPages, loadConceptEntries } from '@/services/insights/page-trend'
import { type Entry } from '@/services/storage/entries'
import {
  listEntriesByEmotion,
  listEntriesByDistortion,
  listEntriesByTopic,
  listEntriesForEntity,
} from '@/services/storage/entries'

jest.mock('@/services/storage/entries', () => ({
  listEntriesByEmotion: jest.fn(async () => ({ success: true, data: [] })),
  listEntriesByDistortion: jest.fn(async () => ({ success: true, data: [] })),
  listEntriesByTopic: jest.fn(async () => ({ success: true, data: [] })),
  listEntriesForEntity: jest.fn(async () => ({ success: true, data: [] })),
}))

const DAY = 86_400_000
const now = new Date(2026, 5, 15, 12).getTime()
const rTs = (i: number): number => now - 5 * DAY - i * 1000 // recent half (~5 days ago)
const eTs = (i: number): number => now - 35 * DAY - i * 1000 // earlier half (~35 days ago)

const base = (ts: number, over: Partial<Entry> = {}): Entry => ({
  id: `${ts}`,
  created_at: ts,
  mood: 3,
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
  topic2: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
  ...over,
})

const many = (n: number, f: (i: number) => Entry): Entry[] => Array.from({ length: n }, (_, i) => f(i))

describe('computePageTrend', () => {
  it('returns null below the minimum window count', () => {
    const concept = many(3, (i) => base(rTs(i)))
    expect(computePageTrend(concept, concept, now, 'Anxiety')).toBeNull()
  })

  it('excludes entries older than the 8-week window from the count', () => {
    const concept = [...many(4, (i) => base(now - 60 * DAY - i * 1000)), ...many(4, (i) => base(rTs(i)))]
    const trend = computePageTrend(concept, concept, now, 'Anxiety')
    expect(trend?.totalEntries).toBe(4) // only the 4 in-window
    expect(trend?.weeks).toHaveLength(8)
  })

  it('reads a falling SHARE even when the raw count is unchanged (volume-robust)', () => {
    // 4 concept entries in each half — identical raw counts. But the earlier half
    // had 8 total entries (share 0.5) and the recent half 40 (share 0.1).
    const concept = [...many(4, (i) => base(eTs(i))), ...many(4, (i) => base(rTs(i)))]
    const filler = [...many(4, (i) => base(eTs(i + 10))), ...many(36, (i) => base(rTs(i + 10)))]
    const trend = computePageTrend(concept, [...concept, ...filler], now, 'Anxiety')
    expect(trend?.frequencyDirection).toBe('falling')
    expect(trend?.message).toContain('less often')
  })

  it('reads a rising share as coming up more often', () => {
    const concept = [...many(4, (i) => base(eTs(i))), ...many(4, (i) => base(rTs(i)))]
    const filler = [...many(36, (i) => base(eTs(i + 10))), ...many(4, (i) => base(rTs(i + 10)))]
    const trend = computePageTrend(concept, [...concept, ...filler], now, 'Anxiety')
    expect(trend?.frequencyDirection).toBe('rising')
    expect(trend?.message).toContain('more often')
  })

  it('flags an emerging concept present only in the recent half', () => {
    const concept = many(6, (i) => base(rTs(i)))
    const trend = computePageTrend(concept, concept, now, 'Loneliness')
    expect(trend?.frequencyDirection).toBe('rising')
    expect(trend?.message).toContain('started coming up')
  })

  it('names a mood dip when frequency held steady', () => {
    const concept = [
      ...many(4, (i) => base(eTs(i), { mood: 4 })),
      ...many(4, (i) => base(rTs(i), { mood: 2 })),
    ]
    const filler = [...many(4, (i) => base(eTs(i + 10))), ...many(4, (i) => base(rTs(i + 10)))]
    const trend = computePageTrend(concept, [...concept, ...filler], now, 'Work')
    expect(trend?.frequencyDirection).toBe('steady')
    expect(trend?.moodDirection).toBe('dipping')
    expect(trend?.message).toContain('heavier')
  })

  it('returns a null message when nothing moved', () => {
    const concept = [...many(4, (i) => base(eTs(i), { mood: 3 })), ...many(4, (i) => base(rTs(i), { mood: 3 }))]
    const filler = [...many(4, (i) => base(eTs(i + 10))), ...many(4, (i) => base(rTs(i + 10)))]
    const trend = computePageTrend(concept, [...concept, ...filler], now, 'Work')
    expect(trend?.frequencyDirection).toBe('steady')
    expect(trend?.moodDirection).toBe('steady')
    expect(trend?.message).toBeNull()
  })

  it('bucket counts sum to the in-window total', () => {
    const concept = many(6, (i) => base(rTs(i)))
    const trend = computePageTrend(concept, concept, now, 'Anxiety')
    const summed = trend?.weeks.reduce((a, w) => a + w.count, 0)
    expect(summed).toBe(trend?.totalEntries)
  })

  it('keeps the message non-clinical and non-valenced for a distortion', () => {
    const concept = [...many(4, (i) => base(eTs(i))), ...many(4, (i) => base(rTs(i)))]
    const filler = [...many(4, (i) => base(eTs(i + 10))), ...many(36, (i) => base(rTs(i + 10)))]
    const trend = computePageTrend(concept, [...concept, ...filler], now, 'Catastrophizing')
    // Falling distortion reads the same neutral way as any other falling concept —
    // no "better", "improving", "good", etc.
    expect(trend?.message).not.toMatch(/better|improv|good|worse|bad|progress/i)
  })
})

describe('computeTrendingPages', () => {
  const page = (id: string, title: string, category: string) => ({ id, title, category })

  it('includes only pages that have a real, nameable trend', async () => {
    const anxiety = many(6, (i) => base(rTs(i))) // emerging → has a message
    const joy = many(2, (i) => base(rTs(i))) // below the window minimum → null
    const load = async (_c: string | null, title: string) => ({
      success: true as const,
      data: title === 'Anxiety' ? anxiety : joy,
    })
    const res = await computeTrendingPages(
      [page('a', 'Anxiety', 'emotion'), page('j', 'Joy', 'emotion')],
      anxiety,
      now,
      load
    )
    expect(res.map((r) => r.page.title)).toEqual(['Anxiety'])
  })

  it('orders pages with more movement first', async () => {
    // Anxiety: share falls AND mood dips (2 signals). Work: emerging only (1 signal).
    const anx = [...many(4, (i) => base(eTs(i), { mood: 4 })), ...many(4, (i) => base(rTs(i), { mood: 2 }))]
    const work = many(6, (i) => base(rTs(i)))
    const load = async (_c: string | null, title: string) => ({
      success: true as const,
      data: title === 'Anxiety' ? anx : work,
    })
    const res = await computeTrendingPages(
      [page('w', 'Work', 'theme'), page('a', 'Anxiety', 'emotion')], // listed Work-first
      [...anx, ...work],
      now,
      load
    )
    expect(res.map((r) => r.page.title)).toEqual(['Anxiety', 'Work'])
  })
})

describe('loadConceptEntries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('dispatches each category to its source query', async () => {
    await loadConceptEntries('emotion', 'Anxiety')
    expect(listEntriesByEmotion).toHaveBeenCalledWith('Anxiety')
    await loadConceptEntries('distortion', 'Catastrophizing')
    expect(listEntriesByDistortion).toHaveBeenCalledWith('Catastrophizing')
    await loadConceptEntries('theme', 'Work')
    expect(listEntriesByTopic).toHaveBeenCalledWith('Work')
    await loadConceptEntries('person', 'Mom')
    expect(listEntriesForEntity).toHaveBeenCalledWith('person', 'Mom')
  })

  it('returns an empty list for an unmapped category', async () => {
    const res = await loadConceptEntries(null, 'Whatever')
    expect(res).toEqual({ success: true, data: [] })
    expect(listEntriesByEmotion).not.toHaveBeenCalled()
  })
})
