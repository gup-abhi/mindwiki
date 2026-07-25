// TDD test for F-03: indexFromExtract bumps TOPIC_TRUNCATION_COUNT_KEY exactly
// once when normalizeTopics returns truncated=true, and not at all when
// truncated=false. The bumpSetting atomicity contract has its own tests in
// __tests__/services/storage/settings.test.ts (uses a real fake db).

import { TOPIC_TRUNCATION_COUNT_KEY, normalizeTopics, processEntry } from '@/services/pipeline'
import { type Entry } from '@/services/storage/entries'

const mockScoreCrisis = jest.fn()
const mockExtractEntry = jest.fn()

jest.mock('@/services/llm/fast-model', () => ({
  scoreCrisis: (input: unknown) => mockScoreCrisis(input),
}))
jest.mock('@/services/llm/deep-model', () => ({
  extractEntry: (input: unknown, opts?: unknown) => mockExtractEntry(input, opts),
}))
jest.mock('@/services/storage/entries', () => ({
  applyTags: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  createEntry: jest.fn(),
  listUnindexedEntries: jest.fn(),
  listWikiPendingEntries: jest.fn(),
  listGraphPendingEntries: jest.fn(),
  markWikiIndexed: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  markGraphIndexed: jest.fn().mockResolvedValue({ success: true, data: undefined }),
}))
jest.mock('@/services/llm/model-manager', () => ({ isModelDownloaded: jest.fn() }))
jest.mock('@/services/storage/entities', () => ({
  setEntitiesForEntry: jest.fn().mockResolvedValue({ success: true, data: undefined }),
}))
jest.mock('@/services/wiki/engine', () => ({
  updateWikiForEntry: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  maybeRefreshEmotionPages: jest.fn().mockResolvedValue({ success: true, data: undefined }),
}))
jest.mock('@/services/graph/engine', () => ({
  updateGraphForEntry: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  rebuildGraph: jest.fn().mockResolvedValue({ success: true, data: undefined }),
}))
jest.mock('@/services/crisis/detector', () => ({
  assessCrisis: jest.fn(() => ({ tier: 0, reasons: [] })),
}))
jest.mock('@/services/notifications/scheduler', () => ({
  onEntrySaved: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  sendFirstPageReadyNotification: jest.fn().mockResolvedValue({ success: true, data: undefined }),
}))
jest.mock('@/services/onboarding/first-run', () => ({
  announceFirstRunPageIfPending: jest.fn(),
}))
jest.mock('@/services/wiki/belief-snap', () => ({
  snapBeliefsSemantic: jest.fn(async (b: string[]) => b),
}))
jest.mock('@/store/wiki.store', () => ({
  useWikiStore: { getState: () => ({ begin: jest.fn(), end: jest.fn(), bumpRevision: jest.fn() }) },
}))
jest.mock('@/store/sync.store', () => ({
  useSyncStore: { getState: () => ({ bumpRevision: jest.fn() }) },
}))

// Tracked bumpSetting spy — the integration boundary we assert on.
const mockBumpSetting = jest.fn(async (_key: string) => ({ success: true, data: 1 }))
jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  bumpSetting: (key: string) => mockBumpSetting(key),
}))

const crisis = (confidence: number) => ({
  success: true as const,
  data: { crisis_confidence: confidence, reasoning: '' },
})

const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: 0,
  mood: 3,
  situation: 'a calm afternoon',
  thought: 'things are okay',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,
  raw_text: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  source: 'journal',
  ...overrides,
}) as any

const flush = () => new Promise<void>((r) => setImmediate(r))
// Drain enough microtasks for the fire-and-forget `extractThenIndex` chain
// (extractEntry → indexFromExtract → normalize → bumpSetting) to settle.
const drain = async () => {
  for (let i = 0; i < 10; i++) await flush()
}

describe('F-03.5 — indexFromExtract increments truncation counter', () => {
  beforeEach(() => {
    mockBumpSetting.mockClear()
    mockScoreCrisis.mockReset()
    mockExtractEntry.mockReset()
    mockScoreCrisis.mockResolvedValue(crisis(0.1))
  })

  it('bumps the counter when model supplies more than two distinct topics', async () => {
    mockExtractEntry.mockResolvedValueOnce({
      success: true as const,
      data: {
        emotion: 'Anxiety',
        distortion: 'catastrophizing',
        mood_score: 3,
        topics: ['Work', 'Sleep', 'Money'], // 3 distinct > 2 → truncated
        people: [],
        places: [],
        activities: [],
        beliefs: [],
        behaviors: [],
      },
    })

    processEntry(makeEntry({ id: 'e1' }))
    await drain()

    expect(mockBumpSetting).toHaveBeenCalledTimes(1)
    expect(mockBumpSetting).toHaveBeenCalledWith(TOPIC_TRUNCATION_COUNT_KEY)
  })

  it('bumps the counter when dedup of input still leaves 3 distinct topics', async () => {
    mockExtractEntry.mockResolvedValueOnce({
      success: true as const,
      data: {
        emotion: 'Anxiety',
        distortion: '',
        mood_score: 3,
        topics: ['Work', 'Work', 'Marriage', 'Sleep'],
        people: [],
        places: [],
        activities: [],
        beliefs: [],
        behaviors: [],
      },
    })

    processEntry(makeEntry({ id: 'e2' }))
    await drain()

    expect(mockBumpSetting).toHaveBeenCalledTimes(1)
  })

  it('does NOT bump the counter when raw topics fit the cap', async () => {
    mockExtractEntry.mockResolvedValueOnce({
      success: true as const,
      data: {
        emotion: 'Calm',
        distortion: '',
        mood_score: 5,
        topics: ['Work', 'Sleep'], // 2 distinct, == cap → not truncated
        people: [],
        places: [],
        activities: [],
        beliefs: [],
        behaviors: [],
      },
    })

    processEntry(makeEntry({ id: 'e3' }))
    await drain()

    expect(mockBumpSetting).not.toHaveBeenCalled()
  })

  it("does NOT bump the counter for ['Work', 'work', 'Marriage'] (dedupe-before-cap)", async () => {
    mockExtractEntry.mockResolvedValueOnce({
      success: true as const,
      data: {
        emotion: 'Calm',
        distortion: '',
        mood_score: 5,
        topics: ['Work', 'work', 'Marriage'],
        people: [],
        places: [],
        activities: [],
        beliefs: [],
        behaviors: [],
      },
    })

    processEntry(makeEntry({ id: 'e4' }))
    await drain()

    expect(mockBumpSetting).not.toHaveBeenCalled()
  })
})

describe('F-03.6 — normalizeTopics export boundary', () => {
  // Exhaustive unit tests live in pipeline-normalize-topics.test.ts.
  it('exported from pipeline', () => {
    expect(typeof normalizeTopics).toBe('function')
  })
})
