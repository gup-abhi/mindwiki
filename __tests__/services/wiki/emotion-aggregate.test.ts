import {
  updateWikiForEntry,
  maybeRefreshEmotionPages,
  backfillEmotionPlaceholders,
} from '@/services/wiki/engine'
import { synthesizeEmotionPage } from '@/services/llm/deep-model'
import { buildEmotionAggregate, distinctRecentExamples } from '@/services/wiki/aggregates'
import {
  getPageByTitle,
  createPage,
  ticklePageCount,
  setAggregatedUpto,
  regeneratePageContent,
  regeneratePageContentWithAggregate,
  listPages,
  type WikiPage,
} from '@/services/storage/wiki'
import { listEntitiesForEntry } from '@/services/storage/entities'
import { listNodes, listEdges } from '@/services/storage/graph'
import { connectionLine } from '@/services/graph/neighborhood'
import { getSetting, setSetting } from '@/services/storage/settings'
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
  regeneratePageContentWithAggregate: jest.fn(),
  listPages: jest.fn(),
}))
jest.mock('@/services/storage/entities', () => ({
  listEntitiesForEntry: jest.fn(),
  countEntriesForEntity: jest.fn(),
  effectiveLabel: (e: { label: string; canonical_label?: string | null }) => {
    const canon = (e.canonical_label ?? '').trim()
    return canon.length > 0 ? canon : e.label
  },
}))
jest.mock('@/services/storage/reframes', () => ({ listReframesForBelief: jest.fn() }))
jest.mock('@/services/wiki/aggregates', () => {
  const actual = jest.requireActual('@/services/wiki/aggregates')
  return {
    ...actual,
    buildEmotionAggregate: jest.fn(),
  }
})
jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
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
const mockRegenAggregate = regeneratePageContentWithAggregate as jest.Mock
const mockListPages = listPages as jest.Mock
const mockListEntities = listEntitiesForEntry as jest.Mock
const mockSynthEmotion = synthesizeEmotionPage as jest.Mock
const mockBuildAgg = buildEmotionAggregate as jest.Mock
const mockListNodes = listNodes as jest.Mock
const mockListEdges = listEdges as jest.Mock
const mockConnectionLine = connectionLine as jest.Mock
const mockGetSetting = getSetting as jest.Mock
const mockSetSetting = setSetting as jest.Mock

const DAY = 24 * 60 * 60 * 1000

// A simple in-memory settings store the mocks read/write. driveEmotionTrigger()
// walks through the durable counter in lock-step with the engine so the scan
// threshold can be reached in a long-running test.
let settingsStore: Record<string, string> = {}

beforeEach(() => {
  settingsStore = {}
  mockGetSetting.mockReset().mockImplementation(async (key: string) => ok(settingsStore[key] ?? null))
  mockSetSetting.mockReset().mockImplementation(async (key: string, value: string) => {
    settingsStore[key] = value
    return ok(undefined)
  })
})

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
  regrounded_upto: 0,
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
  recentExamples: [{ situation: 'work', thought: 'stress', behavior: null, closing_note: null, created_at: Date.now() }],
})

describe('distinctRecentExamples — behavior + closing note (F-1)', () => {
  it('carries behavior into the example payload when present', () => {
    const entries = [
      entry({ id: 'e1', situation: 'a meeting', behavior: 'I skipped the room' }),
    ]
    const out = distinctRecentExamples(entries)
    expect(out).toHaveLength(1)
    expect(out[0].behavior).toBe('I skipped the room')
  })

  it('carries the closing note when present', () => {
    const entries = [
      entry({ id: 'e1', closing_note: 'I can sit with this' }),
    ]
    const out = distinctRecentExamples(entries)
    expect(out).toHaveLength(1)
    expect(out[0].closing_note).toBe('I can sit with this')
  })

  it('leaves behavior/closing_note null when absent (no invention)', () => {
    const entries = [entry({ id: 'e1' })] // behavior:null, closing_note:null by default
    const out = distinctRecentExamples(entries)
    expect(out).toHaveLength(1)
    expect(out[0].behavior).toBeNull()
    expect(out[0].closing_note).toBeNull()
  })
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

    expect(mockTickle).toHaveBeenCalledWith('p1', 'e1')
    // The emotion page is silently tickled — it is not in the returned titles.
    expect(res.success && res.data).toEqual([])
  })

  it('creates a placeholder emotion page when none exists, then tickles it', async () => {
    mockGetByTitle.mockResolvedValue(ok(null))
    mockCreate.mockResolvedValue(ok(page({ id: 'new-p' })))

    await updateWikiForEntry(entry())

    // Seeded with placeholder content so a brand-new page isn't blank in the
    // wiki list while it waits for its first aggregate synthesis.
    expect(mockCreate).toHaveBeenCalledWith({
      title: 'Anxiety',
      category: 'emotion',
      content: expect.stringContaining('anxiety'),
    })
    expect(mockTickle).toHaveBeenCalledWith('new-p', 'e1')
  })
})

describe('emotion trigger — durable across restart (F-3B T-3.3)', () => {
  beforeEach(() => {
    mockGetByTitle.mockReset()
    mockTickle.mockReset()
    mockListPages.mockReset()
    mockListEntities.mockReset().mockResolvedValue(ok([]))
    mockListNodes.mockReset().mockResolvedValue(ok([]))
    mockListEdges.mockReset().mockResolvedValue(ok([]))
    mockConnectionLine.mockReset().mockReturnValue(null)
    mockTickle.mockResolvedValue(ok(page()))
    mockListPages.mockResolvedValue(ok([]))
  })

  it('persists tag progress so a restart does not require 20 more tags', async () => {
    // The durable trigger reads + increments the persisted counter on each tickle.
    // Drive 20 emotion entries; the 20th reaches the threshold and fires a scan
    // (observed via synthesizeEmotionPage on a due page) WITHOUT requiring the
    // in-memory tally to persist each tick — only the persisted count.
    mockGetByTitle.mockResolvedValue(ok(page()))
    mockBuildAgg.mockResolvedValue(ok(aggregate()))
    mockSynthEmotion.mockResolvedValue(ok('fresh prose'))
    mockRegenContent.mockResolvedValue(ok(page({ entry_count: 20 })))
    mockRegenAggregate.mockReset().mockResolvedValue(ok(page({ entry_count: 20, aggregated_upto: 20 })))
    mockSetAgg.mockResolvedValue(undefined)
    // Mark a due page AFTER the 19th tick so the 20th-triggered scan has a target.
    let tick = 0
    mockListPages.mockImplementation(async () => ok(tick < 19 ? [] : [page()]))

    for (let i = 0; i < 19; i++) {
      tick = i
      await updateWikiForEntry(entry())
    }
    expect(mockSynthEmotion).not.toHaveBeenCalled() // not yet at threshold

    tick = 19
    await updateWikiForEntry(entry())
    expect(mockSynthEmotion).toHaveBeenCalledTimes(1) // 20th tick fired the scan
  })
})

describe('maybeRefreshEmotionPages — single-flight (F-3B T-3.4)', () => {
  beforeEach(() => {
    mockListPages.mockReset()
    mockBuildAgg.mockReset()
    mockBuildAgg.mockResolvedValue(ok(aggregate()))
    mockSynthEmotion.mockReset()
    mockSynthEmotion.mockResolvedValue(ok('fresh prose'))
    mockRegenContent.mockReset()
    mockRegenContent.mockResolvedValue(ok(page({ entry_count: 20 })))
    mockRegenAggregate.mockReset().mockResolvedValue(ok(page({ entry_count: 20, aggregated_upto: 20 })))
    mockSetAgg.mockReset().mockResolvedValue(undefined)
  })

  it('two overlapping scans synthesise each due page only once (single-flight)', async () => {
    // Two due pages; call twice without awaiting and confirm only 2 syntheses happen
    // (not 4 — each page processed once, the second call awaits the first's promise).
    mockListPages.mockResolvedValue(ok([page({ id: 'pa' }), page({ id: 'pb' })]))

    const [a, b] = await Promise.all([
      maybeRefreshEmotionPages(),
      maybeRefreshEmotionPages(),
    ])

    expect(mockSynthEmotion).toHaveBeenCalledTimes(2)
    expect(a).toBe(b) // second call returns the first call's count
  })

  it('a failed synthesis leaves the page due for retry (aggregated_upto not advanced)', async () => {
    mockSynthEmotion.mockResolvedValueOnce(err('EMOTION_SYNTH_INFERENCE_FAILED', 'down'))
    mockListPages.mockResolvedValue(ok([page()]))

    await maybeRefreshEmotionPages()

    expect(mockSetAgg).not.toHaveBeenCalled() // marker not advanced on failure
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
    expect(mockRegenAggregate).toHaveBeenCalledWith('p1', 'fresh aggregate prose', 20)
    expect(mockRegenContent).not.toHaveBeenCalled()
    expect(mockSetAgg).not.toHaveBeenCalled()
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

describe('backfillEmotionPlaceholders', () => {
  beforeEach(() => {
    mockListPages.mockReset()
    mockRegenContent.mockReset()
    mockRegenContent.mockResolvedValue(ok(page()))
  })

  it('seeds a blank active emotion page with placeholder text', async () => {
    mockListPages.mockResolvedValue(ok([page({ id: 'blank', title: 'Joy', content: '' })]))

    const res = await backfillEmotionPlaceholders()

    expect(res.success && res.data).toEqual(['Joy'])
    const [id, content] = mockRegenContent.mock.calls[0]
    expect(id).toBe('blank')
    expect(content).toContain('joy')
  })

  it('skips emotion pages that already have content', async () => {
    mockListPages.mockResolvedValue(ok([page({ content: 'real prose' })]))

    const res = await backfillEmotionPlaceholders()

    expect(res.success && res.data).toEqual([])
    expect(mockRegenContent).not.toHaveBeenCalled()
  })

  it('skips non-emotion, dismissed, and merged pages', async () => {
    mockListPages.mockResolvedValue(
      ok([
        page({ category: 'theme', content: '' }),
        page({ content: '', dismissed_at: Date.now() }),
        page({ content: '', merged_into: 'other' }),
      ])
    )

    const res = await backfillEmotionPlaceholders()

    expect(res.success && res.data).toEqual([])
    expect(mockRegenContent).not.toHaveBeenCalled()
  })

  it('reports per-page progress', async () => {
    mockListPages.mockResolvedValue(ok([page({ id: 'blank', title: 'Joy', content: '' })]))
    const events: string[] = []

    await backfillEmotionPlaceholders((p) => events.push(`${p.status}:${p.index}/${p.total}`))

    expect(events).toEqual(['start:1/1', 'done:1/1'])
  })
})
