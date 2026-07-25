import {
  candidateTopics,
  lineageForEntry,
  updateWikiForEntry,
  regeneratePageVoice,
  cleanupConnectionProse,
} from '@/services/wiki/engine'
import { synthesizePage, synthesizePageReGround, regeneratePage } from '@/services/llm/deep-model'
import {
  getPage,
  getPageByTitle,
  createPage,
  updatePage,
  updatePageCAS,
  ticklePageCount,
  setAggregatedUpto,
  listPages,
  regeneratePageContent,
  regeneratePageContentWithAggregate,
  type WikiPage,
} from '@/services/storage/wiki'
import { listEntitiesForEntry, countEntriesForEntity } from '@/services/storage/entities'
import { listReframesForBelief } from '@/services/storage/reframes'
import {
  type Entry,
  listEntriesByEmotion,
  listEntriesByDistortion,
  listEntriesByTopicOrTopic2,
  listEntriesForEntity,
} from '@/services/storage/entries'
import { getSetting, setSetting } from '@/services/storage/settings'
import { listNodes, listEdges } from '@/services/storage/graph'
import { connectionLine } from '@/services/graph/neighborhood'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({
  synthesizePage: jest.fn(),
  synthesizePageReGround: jest.fn(),
  regeneratePage: jest.fn(),
}))
jest.mock('@/services/storage/wiki', () => ({
  getPage: jest.fn(),
  getPageByTitle: jest.fn(),
  createPage: jest.fn(),
  updatePage: jest.fn(),
  updatePageCAS: jest.fn(),
  ticklePageCount: jest.fn(),
  setAggregatedUpto: jest.fn(),
  regeneratePageContent: jest.fn(),
  regeneratePageContentWithAggregate: jest.fn(),
  listPages: jest.fn(),
}))
jest.mock('@/services/storage/wiki-contributions', () => ({
  insertContribution: jest.fn(),
  insertMissingReceipts: jest.fn(),
  hasContribution: jest.fn(),
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
jest.mock('@/services/storage/graph', () => ({
  listNodes: jest.fn(),
  listEdges: jest.fn(),
}))
jest.mock('@/services/graph/neighborhood', () => ({
  connectionLine: jest.fn(),
}))

const mockSynth = synthesizePage as jest.Mock
const mockSynthReGround = synthesizePageReGround as jest.Mock
const mockRegen = regeneratePage as jest.Mock
const mockRegenContent = regeneratePageContent as jest.Mock
const mockRegenAggregate = regeneratePageContentWithAggregate as jest.Mock
const mockListPages = listPages as jest.Mock
const mockGetByTitle = getPageByTitle as jest.Mock
const mockGetPage = getPage as jest.Mock
const mockCreate = createPage as jest.Mock
const mockUpdate = updatePage as jest.Mock
const mockTickleCount = ticklePageCount as jest.Mock
const mockSetAggUpto = setAggregatedUpto as jest.Mock
const mockListEntities = listEntitiesForEntry as jest.Mock
const mockCountEntity = countEntriesForEntity as jest.Mock
const mockListReframes = listReframesForBelief as jest.Mock
import { insertContribution, insertMissingReceipts } from '@/services/storage/wiki-contributions'
const mockUpdateCAS = updatePageCAS as jest.Mock
const mockListNodes = listNodes as jest.Mock
const mockListEdges = listEdges as jest.Mock
const mockConnectionLine = connectionLine as jest.Mock
const mockInsertContribution = insertContribution as jest.Mock
const mockInsertMissingReceipts = insertMissingReceipts as jest.Mock

// Entry-query mocks used by re-grounding (sampleEntriesForPage). These override
// the real functions imported by engine.ts. Type-only imports (type Entry) are
// erased at compile-time, so only the runtime values need mocking.
jest.mock('@/services/storage/entries', () => ({
  listEntriesByEmotion: jest.fn(),
  listEntriesByDistortion: jest.fn(),
  listEntriesByTopicOrTopic2: jest.fn(),
  listEntriesForEntity: jest.fn(),
  listEntriesByEmotionAllSources: jest.fn(),
  listEntriesByDistortionAllSources: jest.fn(),
  listEntriesForEntityAllSources: jest.fn(),
}))
jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}))
const mockGetSetting = getSetting as jest.Mock
const mockSetSetting = setSetting as jest.Mock
const mockEntriesByEmotion = (listEntriesByEmotion as unknown as jest.Mock)
const mockEntriesByDistortion = (listEntriesByDistortion as unknown as jest.Mock)
const mockEntriesByTopic = (listEntriesByTopicOrTopic2 as unknown as jest.Mock)
const mockEntriesForEntity = (listEntriesForEntity as unknown as jest.Mock)
import {
  listEntriesByEmotionAllSources,
  listEntriesByDistortionAllSources,
  listEntriesByTopicOrTopic2 as listEntriesByAnyTopic,
  listEntriesForEntityAllSources,
} from '@/services/storage/entries'
const mockEntriesByEmotionAll = (listEntriesByEmotionAllSources as unknown as jest.Mock)
const mockEntriesByDistortionAll = (listEntriesByDistortionAllSources as unknown as jest.Mock)
const mockEntriesByAnyTopic = (listEntriesByAnyTopic as unknown as jest.Mock)
const mockEntriesForEntityAll = (listEntriesForEntityAllSources as unknown as jest.Mock)

// F-01 Slice 6: re-ground evidence now flows through `listAllSourceEntriesForPage`
// which calls the *AllSources storage variants. The legacy journal-only mocks
// are kept for the recurrence/entity-count code paths; re-ground tests
// additionally seed the all-source mocks so they see the same fixture.
const seedReGroundEvidence = (entries: Partial<Entry>[]) => {
  const asEntries = entries as Entry[]
  mockEntriesByEmotionAll.mockResolvedValue(ok(asEntries))
  mockEntriesByDistortionAll.mockResolvedValue(ok(asEntries))
  mockEntriesByAnyTopic.mockResolvedValue(ok(asEntries))
  mockEntriesForEntityAll.mockResolvedValue(ok(asEntries))
}

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: 0,
  mood: 2,
  situation: 'a meeting',
  thought: 'I will fail',
  behavior: null,
  closing_note: null,
  emotion: null,                    // synthesis tests use distortion/theme; emotion is tested separately
  named_emotion: null,
  energy: null,
  distortion: 'catastrophizing',
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

describe('candidateTopics', () => {
  it('derives title-cased emotion + distortion topics', () => {
    expect(candidateTopics(entry({ emotion: 'anxiety' }))).toEqual([
      { title: 'Anxiety', category: 'emotion' },
      { title: 'Catastrophizing', category: 'distortion' },
    ])
  })

  it('skips distortion "none" and untagged entries', () => {
    expect(candidateTopics(entry({ emotion: 'anxiety', distortion: 'none' }))).toEqual([
      { title: 'Anxiety', category: 'emotion' },
    ])
    expect(candidateTopics(entry({ emotion: null, distortion: null }))).toEqual([])
  })

  it('adds a de-duplicated theme topic when provided', () => {
    const topics = candidateTopics(entry({ emotion: 'anxiety', distortion: 'none' }), ['Work'])
    expect(topics).toEqual([
      { title: 'Anxiety', category: 'emotion' },
      { title: 'Work', category: 'theme' },
    ])
    // a theme equal to an existing topic is de-duped
    const deduped = candidateTopics(entry({ emotion: 'anxiety', distortion: 'none' }), ['anxiety'])
    expect(deduped).toEqual([{ title: 'Anxiety', category: 'emotion' }])
    // multiple themes all land (de-duped against each other + existing)
    const multi = candidateTopics(entry({ emotion: 'anxiety', distortion: 'none' }), ['Work', 'Marriage'])
    expect(multi).toEqual([
      { title: 'Anxiety', category: 'emotion' },
      { title: 'Work', category: 'theme' },
      { title: 'Marriage', category: 'theme' },
    ])
  })
})

describe('updateWikiForEntry', () => {
  beforeEach(() => {
    mockSynth.mockReset()
    mockGetByTitle.mockReset()
    mockGetPage.mockReset()
    mockCreate.mockReset()
    mockUpdate.mockReset()
    mockListEntities.mockReset()
    mockCountEntity.mockReset()
    mockSynth.mockResolvedValue(ok('synthesized content'))
    mockUpdate.mockResolvedValue(ok({}))
    mockTickleCount.mockReset()
    mockTickleCount.mockResolvedValue(ok({ id: 'p', entry_count: 5 }))
    mockSetAggUpto.mockReset()
    mockListEntities.mockResolvedValue(ok([])) // no entities by default
    mockCountEntity.mockResolvedValue(ok(0))
    mockListReframes.mockReset().mockResolvedValue(ok([])) // no reframes by default
    mockListNodes.mockReset()
    mockListNodes.mockResolvedValue(ok([]))               // no graph nodes by default
    mockListEdges.mockReset()
    mockListEdges.mockResolvedValue(ok([]))               // no graph edges by default
    mockConnectionLine.mockReset()
    mockConnectionLine.mockReturnValue(null)               // no connection by default
    mockListPages.mockReset()
    mockListPages.mockResolvedValue(ok([]))                // no pages by default
    mockGetSetting.mockReset().mockResolvedValue(ok(null))   // trigger counter starts at 0
    mockSetSetting.mockReset().mockResolvedValue(ok(undefined))
    mockUpdateCAS.mockReset()
    mockUpdateCAS.mockResolvedValue(ok({ page: { id: 'p1' }, affected: 1 }))
    mockInsertContribution.mockReset()
    mockInsertContribution.mockResolvedValue(ok({ inserted: true }))
    mockInsertMissingReceipts.mockReset()
    mockInsertMissingReceipts.mockResolvedValue(ok({ inserted: 0 }))
    // F-01 Slice 7b: all-source mocks default to empty so non-re-ground tests
    // don't inadvertently trigger re-ground (sourceCount − regrounded_upto >= 10).
    seedReGroundEvidence([])
  })

  it('creates a new page when none exists, then synthesizes and updates it', async () => {
    mockGetByTitle.mockResolvedValue(ok(null))
    mockCreate.mockImplementation(async (input) => ok({ id: 'p', title: input.title, category: input.category, content: '', version: 1 }))

    const result = await updateWikiForEntry(entry({ emotion: null }))

    expect(mockCreate).toHaveBeenCalledWith({ title: 'Catastrophizing', category: 'distortion' })
    // New page: uses non-CAS update (no race possible)
    expect(mockUpdate).toHaveBeenCalledWith('p', 'synthesized content')
    expect(result.success && result.data).toEqual(['Catastrophizing'])
  })

  it('updates an existing page without recreating it', async () => {
    mockGetByTitle.mockResolvedValue(ok({ id: 'p9', title: 'Catastrophizing', category: 'distortion', content: 'old', version: 7 }))

    const result = await updateWikiForEntry(entry({ emotion: null }))

    expect(mockCreate).not.toHaveBeenCalled()
    // Existing page: uses CAS path
    expect(mockUpdateCAS).toHaveBeenCalledWith('p9', 'synthesized content', 7, {}, undefined)
    expect(result.success && result.data).toEqual(['Catastrophizing'])
  })

  it('follows a merged topic to its survivor instead of the hidden page', async () => {
    // A theme page was semantically merged: its title still matches, but it
    // points at the survivor. A new entry on the old topic must build on the
    // survivor, never re-synthesize into the hidden merged page.
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'loser', title: 'Job pressure', category: 'theme', content: 'stale', merged_into: 'survivor' })
    )
    mockGetPage.mockResolvedValue(
      ok({ id: 'survivor', title: 'Work stress', category: 'theme', content: 'live take', merged_into: null })
    )

    const result = await updateWikiForEntry(entry({ emotion: null, distortion: 'none' }), ['Job pressure'])

    // Built on the survivor's content + title, and wrote to the survivor's id.
    expect(mockSynth).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Work stress', existingContent: 'live take' })
    )
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdateCAS).toHaveBeenCalledWith('survivor', 'synthesized content', expect.any(Number), {}, undefined)
    expect(result.success && result.data).toEqual(['Job pressure'])
  })

  it('regenerates a dropped page from scratch (ignores its dismissed content)', async () => {
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'p9', title: 'Catastrophizing', category: 'distortion', content: 'wrong old take', dismissed_at: 123 })
    )

    await updateWikiForEntry(entry({ emotion: null }))

    // synthesized fresh — the dismissed content is NOT fed back in
    expect(mockSynth).toHaveBeenCalledWith(expect.objectContaining({ existingContent: '' }))
    expect(mockUpdateCAS).toHaveBeenCalledWith('p9', 'synthesized content', expect.any(Number), {}, undefined)
  })

  it('builds on existing content for an active (non-dismissed) page', async () => {
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'p9', title: 'Catastrophizing', category: 'distortion', content: 'good prior take', dismissed_at: null })
    )

    await updateWikiForEntry(entry({ emotion: null }))

    expect(mockSynth).toHaveBeenCalledWith(expect.objectContaining({ existingContent: 'good prior take' }))
  })

  it('skips a page when synthesis fails (best-effort)', async () => {
    mockGetByTitle.mockResolvedValue(ok({ id: 'p', title: 'Catastrophizing', category: 'distortion', content: '' }))
    mockSynth.mockResolvedValue(err('SYNTH_INFERENCE_FAILED', 'down'))

    const result = await updateWikiForEntry(entry({ emotion: null }))

    expect(mockUpdateCAS).not.toHaveBeenCalled()
    expect(result.success && result.data).toEqual([])
  })

  it('does not create a new page when synthesis fails (no blank shell)', async () => {
    mockGetByTitle.mockResolvedValue(ok(null)) // page does not exist yet
    mockSynth.mockResolvedValue(err('SYNTH_INFERENCE_FAILED', 'down'))
    mockCreate.mockImplementation(async (input) =>
      ok({ id: 'p', title: input.title, category: input.category, content: '' })
    )

    const result = await updateWikiForEntry(entry({ emotion: null }))

    // synthesis is attempted before any page is created, so a failure leaves nothing
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(result.success && result.data).toEqual([])
  })

  it('only makes an entity page once the entity recurs (≥2 entries)', async () => {
    mockGetByTitle.mockResolvedValue(ok(null))
    mockCreate.mockImplementation(async (input) =>
      ok({ id: input.title, title: input.title, category: input.category, content: '' })
    )
    mockListEntities.mockResolvedValue(
      ok([{ id: 'x1', entry_id: 'e1', type: 'person', label: 'Sarah', created_at: 0 }])
    )

    // First mention: count = 1 → no page for Sarah (only the emotion page, which is silently tickled)
    mockCountEntity.mockResolvedValue(ok(1))
    const first = await updateWikiForEntry(entry({ emotion: 'anxiety', distortion: 'none' }))
    expect(first.success && first.data).toEqual([])
    expect(mockCreate).not.toHaveBeenCalledWith({ title: 'Sarah', category: 'person' })

    // Second mention: count = 2 → Sarah earns a page
    mockCountEntity.mockResolvedValue(ok(2))
    const second = await updateWikiForEntry(entry({ emotion: 'anxiety', distortion: 'none' }))
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Sarah', category: 'person' })
    expect(second.success && second.data).toEqual(['Sarah'])
  })

  it('folds the writer’s latest reframe into a belief page synthesis', async () => {
    mockGetByTitle.mockResolvedValue(ok(null))
    mockCreate.mockImplementation(async (input) =>
      ok({ id: input.title, title: input.title, category: input.category, content: '' })
    )
    mockListEntities.mockResolvedValue(
      ok([{ id: 'b1', entry_id: 'e1', type: 'belief', label: 'I am not good enough', created_at: 0 }])
    )
    mockCountEntity.mockResolvedValue(ok(2)) // recurred → earns a page
    mockListReframes.mockResolvedValue(
      ok([
        {
          id: 'r1',
          belief: 'I am not good enough',
          evidence_for: '',
          evidence_against: '',
          balanced_thought: 'I can be nervous and still capable',
          created_at: 2,
          updated_at: 2,
        },
      ])
    )

    await updateWikiForEntry(entry({ emotion: null, distortion: 'none' }))

    expect(mockListReframes).toHaveBeenCalledWith('I am not good enough')
    expect(mockSynth).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'I am not good enough',
        category: 'belief',
        reframe: 'I can be nervous and still capable',
      })
    )
  })

  it('does not look up reframes for non-belief pages', async () => {
    mockGetByTitle.mockResolvedValue(ok({ id: 'p9', title: 'Catastrophizing', category: 'distortion', content: 'old' }))

    await updateWikiForEntry(entry({ emotion: null }))

    expect(mockListReframes).not.toHaveBeenCalled()
  })

  describe('re-grounding (every 10 entries — sourceCount-based)', () => {
    const oldPage = (over: Partial<WikiPage> = {}): WikiPage => ({
      id: 'p9',
      title: 'Catastrophizing',
      category: 'distortion',
      content: 'You tend to assume worst-case outcomes.',
      entry_count: 10,
      version: 7,
      version_history: [],
      created_at: Date.now() - 2 * 24 * 60 * 60 * 1000, // older than 24h
      updated_at: 100,
      dismissed_at: null,
      corrected_at: null,
      merged_into: null,
      aggregated_upto: 0,
      regrounded_upto: 0,
      ...over,
    })
    const sampleEntry = {
      id: 'e1',
      situation: 'Had a tough standup',
      thought: 'Everyone saw me stumble',
      created_at: 1710000000000,
    }
    // Seed enough entries so sourceCount (≥10) − regrounded_upto (0) ≥ RE_GROUND_INTERVAL
    const manyEntries = Array.from({ length: 10 }, (_, i) => ({
      ...sampleEntry,
      id: `e${i + 1}`,
      created_at: 1710000000000 + i * 86_400_000,
    }))

    beforeEach(() => {
      mockSynthReGround.mockReset()
      mockSynthReGround.mockResolvedValue(ok('re-grounded content'))
      mockEntriesByDistortion.mockReset()
      mockEntriesByDistortion.mockResolvedValue(ok([sampleEntry]))
      // F-01 Slice 7b — seed ≥10 all-source entries so the sourceCount check fires.
      mockEntriesByEmotionAll.mockReset()
      mockEntriesByDistortionAll.mockReset()
      mockEntriesByAnyTopic.mockReset()
      mockEntriesForEntityAll.mockReset()
      seedReGroundEvidence(manyEntries)
    })

    it('uses re-grounding synthesis at entry_count % 10 === 0', async () => {
      mockGetByTitle.mockResolvedValue(ok(oldPage()))

      await updateWikiForEntry(entry({ emotion: null }))

      expect(mockSynthReGround).toHaveBeenCalled()
      expect(mockSynth).not.toHaveBeenCalled()
    })

    it('passes sampled past entries to the re-ground prompt', async () => {
      mockGetByTitle.mockResolvedValue(ok(oldPage()))

      await updateWikiForEntry(entry({ emotion: null }))

      expect(mockSynthReGround).toHaveBeenCalledWith(
        expect.objectContaining({
          pastEntries: expect.arrayContaining([
            expect.objectContaining({ situation: 'Had a tough standup' }),
          ]),
        })
      )
    })

    it('still uses normal synthesis when sourceCount − regrounded_upto < interval', async () => {
      mockGetByTitle.mockResolvedValue(ok(oldPage({ entry_count: 7 })))
      // Override the all-source mocks to return few entries so sourceCount check
      // doesn't trigger re-ground despite the ambient 10-entry beforeEach seed.
      seedReGroundEvidence([sampleEntry])

      await updateWikiForEntry(entry({ emotion: null }))

      expect(mockSynth).toHaveBeenCalled()
      expect(mockSynthReGround).not.toHaveBeenCalled()
    })

    it('falls back to normal synthesis when past entry queries come back empty', async () => {
      mockGetByTitle.mockResolvedValue(ok(oldPage()))
      mockEntriesByDistortion.mockResolvedValue(ok([])) // empty
      // F-01 Slice 6: re-ground reads all-source variants too — set empty.
      seedReGroundEvidence([])

      await updateWikiForEntry(entry({ emotion: null }))

      // No past entries → falls through to normal synth
      expect(mockSynth).toHaveBeenCalled()
      expect(mockSynthReGround).not.toHaveBeenCalled()
    })

    it('skips re-grounding for a page younger than 24h', async () => {
      const freshPage = oldPage({ created_at: Date.now() - 1000 }) // 1 second old
      mockGetByTitle.mockResolvedValue(ok(freshPage))

      await updateWikiForEntry(entry({ emotion: null }))

      expect(mockSynth).toHaveBeenCalled()
      expect(mockSynthReGround).not.toHaveBeenCalled()
    })

    it('skips re-grounding for entry_count === 0 (no prior)', async () => {
      mockGetByTitle.mockResolvedValue(ok(oldPage({ entry_count: 0 })))

      await updateWikiForEntry(entry({ emotion: null }))

      expect(mockSynth).toHaveBeenCalled()
      expect(mockSynthReGround).not.toHaveBeenCalled()
    })

    it('passes entry.behavior to re-ground synthesis when present (F-1)', async () => {
      mockGetByTitle.mockResolvedValue(ok(oldPage())) // satisfies re-ground age + %10
      mockEntriesByDistortion.mockResolvedValue(ok([sampleEntry]))
      mockSynthReGround.mockResolvedValue(ok('re-grounded content'))

      await updateWikiForEntry(entry({ emotion: null, behavior: 'I walked off the floor' }))

      expect(mockSynthReGround).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'I walked off the floor' })
      )
    })

    it('excludes the current entry from the historical past-entries sample (F-1)', async () => {
      // The current entry may also appear in the historical query. It must be
      // dropped from pastEntries (the current entry already has its own block),
      // so its evidence isn't doubled.
      const current = entry({ id: 'the-current', emotion: null })
      mockGetByTitle.mockResolvedValue(ok(oldPage()))
      mockEntriesByDistortion.mockResolvedValue(ok([
        { id: 'the-current', situation: 'current match', thought: 'dup', created_at: 123 },
        sampleEntry as any,
      ]))
      mockSynthReGround.mockResolvedValue(ok('re-grounded content'))

      await updateWikiForEntry(current)

      const call = mockSynthReGround.mock.calls[0][0]
      const pastTitles = call.pastEntries.map((p: any) => p.situation)
      expect(pastTitles).not.toContain('current match')
      expect(pastTitles).toContain('Had a tough standup')
    })
  })

  it('does not load graph data or pass any connection line to synthesis', async () => {
    // Connections now render as a deterministic structured block (WikiConnections),
    // NOT woven into LLM prose. updateWikiForEntry must not load graph data or
    // include a connectionLine arg on the synthesis call.
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'p9', title: 'Catastrophizing', category: 'distortion', content: 'old', dismissed_at: null })
    )
    mockListNodes.mockResolvedValue(ok([
      { id: 'a', type: 'distortion', label: 'Catastrophizing', frequency: 5, created_at: 0, updated_at: 0 },
      { id: 'b', type: 'theme', label: 'Work', frequency: 3, created_at: 0, updated_at: 0 },
    ]))
    mockListEdges.mockResolvedValue(ok([
      { id: 'e1', source_id: 'a', target_id: 'b', weight: 3, created_at: 0, updated_at: 0 },
    ]))
    mockConnectionLine.mockReturnValue('Catastrophizing often comes up with Work.')

    await updateWikiForEntry(entry({ emotion: null }))

    expect(mockListNodes).not.toHaveBeenCalled()
    expect(mockListEdges).not.toHaveBeenCalled()
    expect(mockConnectionLine).not.toHaveBeenCalled()
    const call = mockSynth.mock.calls[0][0]
    expect(call.connectionLine).toBeUndefined()
  })

  // F-1: raw entry.behavior reaches both synthesis paths

  it('passes entry.behavior to normal synthesis when present', async () => {
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'p9', title: 'Catastrophizing', category: 'distortion', content: 'old', dismissed_at: null })
    )

    await updateWikiForEntry(entry({ emotion: null, behavior: 'I walked away from the argument' }))

    expect(mockSynth).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'I walked away from the argument' })
    )
  })

  it('passes behavior:null to synthesis when the entry omitted step 4', async () => {
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'p9', title: 'Catastrophizing', category: 'distortion', content: 'old', dismissed_at: null })
    )

    await updateWikiForEntry(entry({ emotion: null, behavior: null }))

    expect(mockSynth).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: null })
    )
  })
})

describe('cleanupConnectionProse', () => {
  beforeEach(() => {
    mockRegenContent.mockReset()
    mockRegenContent.mockResolvedValue(ok({ id: 'p', content: 'cleaned', entry_count: 5, version: 2 }))
    mockListPages.mockReset()
    mockListPages.mockResolvedValue(ok([]))
  })

  it('skips pages with no stale connection prose', async () => {
    mockListPages.mockResolvedValue(ok([
      { id: 'p1', title: 'Work', category: 'theme', content: 'You stress.', entry_count: 3, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
    ]))
    const result = await cleanupConnectionProse()
    expect(mockRegenContent).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([])
  })

  it('cleans connection-prose pages and the knowledge-graph-shows leak', async () => {
    mockListPages.mockResolvedValue(ok([
      { id: 'p1', title: 'Work', category: 'theme', content: 'You stress.\nThe knowledge graph shows: Work often comes up with Anxiety.\nBack to the page.', entry_count: 3, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
      { id: 'p2', title: 'Anxiety', category: 'emotion', content: 'You worry.\nAnxiety often comes up with Work, Sleep.', entry_count: 5, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
      { id: 'p3', title: 'Clean', category: 'theme', content: 'A normal page.', entry_count: 1, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
    ]))

    const result = await cleanupConnectionProse()

    expect(mockRegenContent).toHaveBeenCalledTimes(2)
    expect(mockRegenContent).toHaveBeenCalledWith('p1', 'You stress.\nBack to the page.')
    expect(mockRegenContent).toHaveBeenCalledWith('p2', 'You worry.')
    if (result.success) {
      expect(result.data).toEqual(['Work', 'Anxiety'])
    }
  })

  it('reports per-page progress as each page is cleaned', async () => {
    mockListPages.mockResolvedValue(ok([
      { id: 'p1', title: 'Work', category: 'theme', content: 'You stress.\nWork often comes up with Anxiety.', entry_count: 3, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
      { id: 'p2', title: 'Sleep', category: 'theme', content: 'You rest.\nSleep often comes up with Anxiety.', entry_count: 4, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
    ]))

    const events: Array<{ title: string; index: number; total: number; status: string }> = []
    await cleanupConnectionProse((p) => events.push(p))

    expect(events).toEqual([
      { title: 'Work', index: 1, total: 2, status: 'start' },
      { title: 'Work', index: 1, total: 2, status: 'done' },
      { title: 'Sleep', index: 2, total: 2, status: 'start' },
      { title: 'Sleep', index: 2, total: 2, status: 'done' },
    ])
  })

  it('reports a failed status when persist fails', async () => {
    mockListPages.mockResolvedValue(ok([
      { id: 'p1', title: 'Work', category: 'theme', content: 'You stress.\nWork often comes up with Anxiety.', entry_count: 3, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
    ]))
    mockRegenContent.mockResolvedValue(err('WIKI_REGEN_FAILED', 'down'))

    const events: Array<{ title: string; status: string }> = []
    const result = await cleanupConnectionProse((p) => events.push({ title: p.title, status: p.status }))

    expect(events).toEqual([
      { title: 'Work', status: 'start' },
      { title: 'Work', status: 'failed' },
    ])
    if (result.success) expect(result.data).toEqual([])
  })

  it('works with no callback', async () => {
    mockListPages.mockResolvedValue(ok([
      { id: 'p1', title: 'Work', category: 'theme', content: 'You stress.\nWork often comes up with Anxiety.', entry_count: 3, version: 1, version_history: [], created_at: 0, updated_at: 0, dismissed_at: null, corrected_at: null, merged_into: null, aggregated_upto: 0, regrounded_upto: 0 },
    ]))
    const result = await cleanupConnectionProse()
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(['Work'])
  })
})

describe('regeneratePageVoice', () => {
  const page = {
    id: 'p1',
    title: 'Anxiety',
    category: 'emotion',
    content: 'I always panic before meetings.',
  } as WikiPage

  beforeEach(() => {
    mockRegen.mockReset()
    mockRegenContent.mockReset()
  })

  it('rewrites the page content via the deep model, then persists it', async () => {
    mockRegen.mockResolvedValue(ok('You tend to expect the worst before meetings.'))
    mockRegenContent.mockResolvedValue(ok({ ...page, content: 'rewritten' }))

    const res = await regeneratePageVoice(page)

    expect(mockRegen).toHaveBeenCalledWith({
      title: 'Anxiety',
      category: 'emotion',
      content: 'I always panic before meetings.',
    })
    expect(mockRegenContent).toHaveBeenCalledWith('p1', 'You tend to expect the worst before meetings.')
    expect(res.success).toBe(true)
  })

  it('does not persist when the model fails', async () => {
    mockRegen.mockResolvedValue(err('REGEN_INFERENCE_FAILED', 'no model'))

    const res = await regeneratePageVoice(page)

    expect(res.success).toBe(false)
    expect(mockRegenContent).not.toHaveBeenCalled()
  })
})

describe('lineageForEntry', () => {
  const page = (over: Partial<WikiPage> = {}): WikiPage => ({
    id: 'p',
    title: 'Anxiety',
    category: 'emotion',
    content: 'x',
    entry_count: 3,
    version: 1,
    version_history: [],
    created_at: 0,
    updated_at: 0,
    dismissed_at: null,
    corrected_at: null,
    merged_into: null,
    aggregated_upto: 0,
    regrounded_upto: 0,
    ...over,
  })

  beforeEach(() => {
    mockGetByTitle.mockReset()
    mockListEntities.mockReset()
    mockCountEntity.mockReset()
    mockListEntities.mockResolvedValue(ok([]))
  })

  it('returns the live pages an entry shaped, skipping missing and dismissed ones', async () => {
    mockGetByTitle.mockImplementation((title: string) => {
      if (title === 'Anxiety') return Promise.resolve(ok(page({ id: 'p1', title: 'Anxiety' })))
      // Catastrophizing page was dropped → excluded
      if (title === 'Catastrophizing')
        return Promise.resolve(ok(page({ id: 'p2', title: 'Catastrophizing', dismissed_at: 1 })))
      return Promise.resolve(ok(null))
    })

    const res = await lineageForEntry(entry({ emotion: 'anxiety' }))

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data).toEqual([{ id: 'p1', title: 'Anxiety', category: 'emotion' }])
  })

  it('includes a recurring entity page the entry contributed to', async () => {
    mockListEntities.mockResolvedValue(ok([{ id: 'x', entry_id: 'e1', type: 'activity', label: 'App' }]))
    mockCountEntity.mockResolvedValue(ok(2)) // recurred → has a page
    mockGetByTitle.mockImplementation((title: string) =>
      title === 'App'
        ? Promise.resolve(ok(page({ id: 'pa', title: 'App', category: 'activity' })))
        : Promise.resolve(ok(null))
    )

    const res = await lineageForEntry(entry({ emotion: null, distortion: null }))

    expect(res.success && res.data).toEqual([{ id: 'pa', title: 'App', category: 'activity' }])
  })

  it('returns an empty list when the entry has touched no live pages', async () => {
    mockGetByTitle.mockResolvedValue(ok(null))
    const res = await lineageForEntry(entry())
    expect(res.success && res.data).toEqual([])
  })
})
