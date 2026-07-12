import { updateWikiForEntry, maybeRefreshEmotionPages } from '@/services/wiki/engine'
import { synthesizeEmotionPage } from '@/services/llm/deep-model'
import { buildEmotionAggregate } from '@/services/wiki/aggregates'
import {
  getPageByTitle,
  createPage,
  ticklePageCount,
  setAggregatedUpto,
  regeneratePageContent,
  listPages,
  type WikiPage,
} from '@/services/storage/wiki'
import { listEntitiesForEntry } from '@/services/storage/entities'
import { listNodes, listEdges } from '@/services/storage/graph'
import { connectionLine } from '@/services/graph/neighborhood'
import { type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

// Only the collaborators the emotion path touches. synthesizePage etc. must be
// present so engine.ts's imports resolve, but they should never be called here.
jest.mock('@/services/llm/deep-model', () => ({
  synthesizePage: jest.fn(),
  synthesizePageReGround: jest.fn(),
  synthesizeEmotionPage: jest.fn(),
  regeneratePage: jest.fn(),
}))
jest.mock('@/services/storage/wiki', () => ({
  getPage: jest.fn(),
  getPageByTitle: jest.fn(),
  createPage: jest.fn(),
  updatePage: jest.fn(),
  ticklePageCount: jest.fn(),
  setAggregatedUpto: jest.fn(),
  regeneratePageContent: jest.fn(),
  listPages: jest.fn(),
}))
jest.mock('@/services/storage/entities', () => ({
  listEntitiesForEntry: jest.fn(),
  countEntriesForEntity: jest.fn(),
}))
jest.mock('@/services/storage/reframes', () => ({ listReframesForBelief: jest.fn() }))
jest.mock('@/services/wiki/aggregates', () => ({
  buildEmotionAggregate: jest.fn(),
}))
// updateWikiForEntry and refreshSingleEmotionPage load the graph for connection
// lines. Configured per-test; empty by default.
jest.mock('@/services/storage/graph', () => ({
  listNodes: jest.fn(),
  listEdges: jest.fn(),
}))
jest.mock('@/services/graph/neighborhood', () => ({
  connectionLine: jest.fn(),
}))

const mockGetByTitle = getPageByTitle as jest.Mock
const mockCreate = createPage as jest.Mock
const mockTickle = ticklePageCount as jest.Mock
const mockSetAgg = setAggregatedUpto as jest.Mock
const mockRegenContent = regeneratePageContent as jest.Mock
const mockListPages = listPages as jest.Mock
const mockListEntities = listEntitiesForEntry as jest.Mock
const mockSynthEmotion = synthesizeEmotionPage as jest.Mock
const mockBuildAgg = buildEmotionAggregate as jest.Mock
const mockListNodes = listNodes as jest.Mock
const mockListEdges = listEdges as jest.Mock
const mockConnectionLine = connectionLine as jest.Mock

const DAY = 24 * 60 * 60 * 1000

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: Date.now(),
  mood: 2,
  situation: 'a meeting',
  thought: 'I will fail',
  behavior: null,
  closing_note: null,
  emotion: 'anxiety',
  named_emotion: null,
  energy: null,
  distortion: 'none',
  mood_score: 0.2,
  topic: null,
  topic2: null,
  tagged_at: 1,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
  ...over,
})

const page = (over: Partial<WikiPage> = {}): WikiPage => ({
  id: 'p1',
  title: 'Anxiety',
  category: 'emotion',
  content: 'existing content',
  entry_count: 20,
  version: 3,
  version_history: [],
  aggregated_upto: 0,
  created_at: Date.now() - 30 * DAY, // old enough by default
  updated_at: Date.now(),
  dismissed_at: null,
  corrected_at: null,
  merged_into: null,
  ...over,
})

const aggregate = () => ({
  emotion: 'Anxiety',
  totalCount: 20,
  recentCount: { last4weeks: 8, last8weeks: 15 },
  topSituations: [{ pattern: 'work', count: 5 }],
  moodTrend: { recentAvg: 2.4, priorAvg: 2.8, direction: 'down' as const },
  recentExamples: [{ situation: 'work', thought: 'stress', created_at: Date.now() }],
})

describe('updateWikiForEntry — emotion routing', () => {
  beforeEach(() => {
    mockGetByTitle.mockReset()
    mockCreate.mockReset()
    mockTickle.mockReset()
    mockListPages.mockReset()
    mockListEntities.mockReset()
    mockListEntities.mockResolvedValue(ok([]))
    mockListNodes.mockReset()
    mockListEdges.mockReset()
    mockConnectionLine.mockReset()
    mockListNodes.mockResolvedValue(ok([]))
    mockListEdges.mockResolvedValue(ok([]))
    mockConnectionLine.mockReturnValue(null)
    // Keep the global tally from firing an aggregate scan mid-tickle-test.
    mockListPages.mockResolvedValue(ok([]))
    mockTickle.mockResolvedValue(ok(page()))
  })

  it('tickles an existing emotion page instead of synthesizing it', async () => {
    mockGetByTitle.mockResolvedValue(ok(page()))

    const res = await updateWikiForEntry(entry())

    expect(mockTickle).toHaveBeenCalledWith('p1')
    // The emotion page is silently tickled — it is not in the returned titles.
    expect(res.success && res.data).toEqual([])
  })

  it('creates a placeholder emotion page when none exists, then tickles it', async () => {
    mockGetByTitle.mockResolvedValue(ok(null))
    mockCreate.mockResolvedValue(ok(page({ id: 'new-p' })))

    await updateWikiForEntry(entry())

    expect(mockCreate).toHaveBeenCalledWith({ title: 'Anxiety', category: 'emotion' })
    expect(mockTickle).toHaveBeenCalledWith('new-p')
  })
})

describe('maybeRefreshEmotionPages', () => {
  beforeEach(() => {
    mockListPages.mockReset()
    mockBuildAgg.mockReset()
    mockSynthEmotion.mockReset()
    mockRegenContent.mockReset()
    mockSetAgg.mockReset()
    mockBuildAgg.mockResolvedValue(ok(aggregate()))
    mockSynthEmotion.mockResolvedValue(ok('fresh aggregate prose'))
    mockRegenContent.mockResolvedValue(ok(page({ entry_count: 20 })))
    mockSetAgg.mockResolvedValue(undefined)
    mockListNodes.mockReset()
    mockListEdges.mockReset()
    mockConnectionLine.mockReset()
    mockListNodes.mockResolvedValue(ok([]))
    mockListEdges.mockResolvedValue(ok([]))
    mockConnectionLine.mockReturnValue(null)
  })

  it('refreshes a due emotion page and marks aggregated_upto', async () => {
    mockListPages.mockResolvedValue(ok([page()]))

    const n = await maybeRefreshEmotionPages()

    expect(n).toBe(1)
    expect(mockSynthEmotion).toHaveBeenCalled()
    expect(mockRegenContent).toHaveBeenCalledWith('p1', 'fresh aggregate prose')
    expect(mockSetAgg).toHaveBeenCalledWith('p1', 20)
  })

  it('does NOT load graph data or pass a connection line to emotion synthesis', async () => {
    // Connections now render as a deterministic structured block, never woven
    // into LLM prose. emotion page synthesis should not load graph data or
    // include a connectionLine arg on the synthesis call.
    mockListPages.mockResolvedValue(ok([page()]))
    mockListNodes.mockResolvedValue(ok([{ id: 'n1', label: 'Anxiety', type: 'emotion', frequency: 20 }]))
    mockListEdges.mockResolvedValue(ok([{ id: 'ed1', source_id: 'n1', target_id: 'n2', weight: 5 }]))
    mockConnectionLine.mockReturnValue('Anxiety often comes up with Work, Sleep.')

    await maybeRefreshEmotionPages()

    expect(mockListNodes).not.toHaveBeenCalled()
    expect(mockListEdges).not.toHaveBeenCalled()
    expect(mockConnectionLine).not.toHaveBeenCalled()
    const call = mockSynthEmotion.mock.calls[0][0]
    expect(call.connectionLine).toBeUndefined()
  })

  it('omits the connection line from emotion synthesis when the graph is empty', async () => {
    mockListPages.mockResolvedValue(ok([page()]))

    await maybeRefreshEmotionPages()

    expect(mockListNodes).not.toHaveBeenCalled()
    expect(mockListEdges).not.toHaveBeenCalled()
    const call = mockSynthEmotion.mock.calls[0][0]
    expect(call.connectionLine).toBeUndefined()
  })

  it('does NOT gate on updated_at — a page tickled today still refreshes', async () => {
    // Regression: updated_at is bumped on every tickle, so gating on it would
    // permanently block the daily-touched high-traffic pages this feature targets.
    mockListPages.mockResolvedValue(ok([page({ updated_at: Date.now() })]))

    const n = await maybeRefreshEmotionPages()

    expect(n).toBe(1)
  })

  it('skips a brand-new page younger than 24h (created_at gate)', async () => {
    mockListPages.mockResolvedValue(ok([page({ created_at: Date.now() - 1000 })]))

    const n = await maybeRefreshEmotionPages()

    expect(n).toBe(0)
    expect(mockSynthEmotion).not.toHaveBeenCalled()
  })

  it('skips a page below the minimum entry count', async () => {
    mockListPages.mockResolvedValue(ok([page({ entry_count: 3 })]))
    expect(await maybeRefreshEmotionPages()).toBe(0)
  })

  it('skips a page without enough new entries since last aggregate', async () => {
    // 20 entries, aggregated_upto 15 → only 5 new, below batch size of 10
    mockListPages.mockResolvedValue(ok([page({ entry_count: 20, aggregated_upto: 15 })]))
    expect(await maybeRefreshEmotionPages()).toBe(0)
  })

  it('ignores non-emotion pages', async () => {
    mockListPages.mockResolvedValue(ok([page({ category: 'theme' })]))
    expect(await maybeRefreshEmotionPages()).toBe(0)
  })

  it('does not synthesize when the aggregate has zero entries', async () => {
    mockBuildAgg.mockResolvedValue(ok({ ...aggregate(), totalCount: 0 }))
    mockListPages.mockResolvedValue(ok([page()]))
    expect(await maybeRefreshEmotionPages()).toBe(0)
    expect(mockSynthEmotion).not.toHaveBeenCalled()
  })

  it('is best-effort: a synthesis failure on one page does not throw', async () => {
    mockSynthEmotion.mockResolvedValue(err('EMOTION_SYNTH_INFERENCE_FAILED', 'down'))
    mockListPages.mockResolvedValue(ok([page()]))
    expect(await maybeRefreshEmotionPages()).toBe(0)
    expect(mockSetAgg).not.toHaveBeenCalled()
  })
})
