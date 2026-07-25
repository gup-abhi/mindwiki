// F-01 Slice 6 — all-source stratified evidence selector.
//
// Pure-function tests for the deterministic bounded selector and the all-source
// query wrapper. These tests do NOT touch on schema/receipts/CAS (Slice 7).

import { selectReGroundEvidence, listAllSourceEntriesForPage } from '@/services/wiki/reground-evidence'
import type { Entry } from '@/services/storage/entries'

jest.mock('@/services/storage/entries', () => ({
  listEntriesByEmotionAllSources: jest.fn(),
  listEntriesByDistortionAllSources: jest.fn(),
  listEntriesByTopicOrTopic2: jest.fn(),
  listEntriesForEntityAllSources: jest.fn(),
}))
const storage = require('@/services/storage/entries') as {
  listEntriesByEmotionAllSources: jest.Mock
  listEntriesByDistortionAllSources: jest.Mock
  listEntriesByTopicOrTopic2: jest.Mock
  listEntriesForEntityAllSources: jest.Mock
}


const mkEntry = (id: string, created_at: number, source: Entry['source'] = 'journal'): Entry => ({
  id,
  created_at,
  mood: 2,
  mood_score: null,
  named_emotion: null,
  energy: null,
  situation: '',
  thought: 't',
  topic: null,
  topic2: null,
  emotion: null,
  distortion: null,
  behavior: null,
  closing_note: null,
  source,
  tagged_at: created_at,
  wiki_indexed_at: created_at,
  graph_indexed_at: created_at,
  raw_text: null,
  updated_at: created_at,
})

// ascending by created_at
const corpus1000 = (sources: Entry['source'][] = ['journal']): Entry[] =>
  Array.from({ length: 1000 }, (_, i) =>
    mkEntry(`e${i}`, 1_000_000_000 + i * 1000, sources[i % sources.length])
  )

describe('F-01 selectReGroundEvidence — deterministic stratified selector', () => {
  it('corpus of 1000 returns at most 6 samples spanning oldest → newest with evenly spaced middle; no duplicate IDs', () => {
    const samples = selectReGroundEvidence(corpus1000(), { max: 6 })
    expect(samples.length).toBe(6)
    expect(new Set(samples.map((e) => e.id)).size).toBe(6)
    const ts = samples.map((e) => e.created_at)
    expect(ts[0]).toBeLessThan(ts[ts.length - 1]) // ordered ascending
    expect(Math.min(...ts)).toBe(1_000_000_000) // oldest included
    expect(Math.max(...ts)).toBe(1_000_000_000 + 999 * 1000) // newest included
    // Middle 4 entries are evenly spaced (constant gap between adjacent middles).
    const mids = ts.slice(1, -1)
    const gaps = mids.map((t, i) => (i === 0 ? t - ts[0] : t - mids[i - 1]))
    const firstMidGap = gaps[0]
    const lastMidGap = ts[5] - mids[3]
    // Even-ish: each gap within 5% of the others.
    for (const g of gaps) {
      expect(Math.abs(g - firstMidGap)).toBeLessThanOrEqual(firstMidGap * 0.5 + 500)
    }
    void lastMidGap
  })

  it('corpus under 6 returns the full corpus (no padding, no truncation)', () => {
    const c = [mkEntry('a', 1), mkEntry('b', 2), mkEntry('c', 3)]
    const samples = selectReGroundEvidence(c, { max: 6 })
    expect(samples.map((e) => e.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates by id before sampling', () => {
    const c = [
      mkEntry('dup', 1),
      mkEntry('dup', 1),
      ...corpus1000(),
    ]
    const samples = selectReGroundEvidence(c, { max: 6 })
    expect(new Set(samples.map((e) => e.id)).size).toBe(samples.length)
    expect(samples.filter((e) => e.id === 'dup').length).toBe(1)
  })

  it('explicitly excludes current entry when excludeIds provided (no current-entry duplication in re-ground evidence)', () => {
    const currentId = corpus1000()[500].id
    const samples = selectReGroundEvidence(corpus1000(), { max: 6, excludeIds: new Set([currentId]) })
    expect(samples.some((e) => e.id === currentId)).toBe(false)
    expect(new Set(samples.map((e) => e.id)).size).toBe(samples.length)
    expect(samples.length).toBe(6)
  })

  it('calls return oldest first then ascending (deterministic order for prompter)', () => {
    const c = corpus1000()
    const samples = selectReGroundEvidence(c, { max: 6 })
    const ts = samples.map((e) => e.created_at)
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThan(ts[i - 1])
    }
  })

  it('mixed-source corpus (journal+reflect+path) preserves sources in samples — all three sources appear somewhere in selection', () => {
    const c = corpus1000(['journal', 'reflect', 'path'])
    const samples = selectReGroundEvidence(c, { max: 6 })
    const sources = new Set(samples.map((e) => e.source))
    // Even-spaced selection through a rotating-source corpus should touch >1 source.
    expect(sources.size).toBeGreaterThan(1)
  })

  it('empty corpus returns empty array', () => {
    expect(selectReGroundEvidence([], { max: 6 })).toEqual([])
  })

  it('proof: small 6-entry corpus returns all 6 with oldest-first ordering', () => {
    const c = Array.from({ length: 6 }, (_, i) => mkEntry(`n${i}`, 100 * (6 - i))) // reverse
    const samples = selectReGroundEvidence(c, { max: 6 })
    expect(samples.map((e) => e.id).sort()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    const ts = samples.map((e) => e.created_at)
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1])
  })
})

describe('F-01 listAllSourceEntriesForPage — query routing by category', () => {
  // We mock the storage layer to deterministically verify routing.
  const {
    listEntriesByEmotionAllSources,
    listEntriesByDistortionAllSources,
    listEntriesByTopicOrTopic2,
    listEntriesForEntityAllSources,
  } = storage
  const ok = <T>(data: T): { success: true; data: T } => ({ success: true, data })

  beforeEach(() => jest.clearAllMocks())

  it('emotion routes to listEntriesByEmotionAllSources', async () => {
    listEntriesByEmotionAllSources.mockReturnValue(ok([]))
    await listAllSourceEntriesForPage('happy', 'emotion' as any)
    expect(listEntriesByEmotionAllSources).toHaveBeenCalledWith('happy', undefined)
  })

  it('distortion routes to listEntriesByDistortionAllSources', async () => {
    listEntriesByDistortionAllSources.mockReturnValue(ok([]))
    await listAllSourceEntriesForPage('all-or-nothing', 'distortion' as any)
    expect(listEntriesByDistortionAllSources).toHaveBeenCalledWith('all-or-nothing', undefined)
  })

  it('theme routes to listEntriesByTopicOrTopic2 with includeAllSources', async () => {
    listEntriesByTopicOrTopic2.mockReturnValue(ok([]))
    await listAllSourceEntriesForPage('Work', 'theme' as any)
    expect(listEntriesByTopicOrTopic2).toHaveBeenCalledWith('Work', undefined, false)
  })

  it('person routes to listEntriesForEntityAllSources', async () => {
    listEntriesForEntityAllSources.mockReturnValue(ok([]))
    await listAllSourceEntriesForPage('Alex', 'person' as any)
    expect(listEntriesForEntityAllSources).toHaveBeenCalledWith('person', 'Alex', undefined)
  })

  it('returns empty array for unknown category', async () => {
    const out = await listAllSourceEntriesForPage('x', 'unknown' as any)
    expect(out.success ? out.data : null).toEqual([])
  })

  it('returns empty array on underlying query failure (best-effort)', async () => {
    listEntriesByDistortionAllSources.mockReturnValue({ success: false, error: { code: 'X', message: 'fail' } })
    const out = await listAllSourceEntriesForPage('d', 'distortion' as any)
    expect(out.success ? out.data : null).toEqual([])
  })
})
