import {
  candidateTopics,
  lineageForEntry,
  updateWikiForEntry,
  regeneratePageVoice,
} from '@/services/wiki/engine'
import { synthesizePage, regeneratePage } from '@/services/llm/deep-model'
import {
  getPage,
  getPageByTitle,
  createPage,
  updatePage,
  regeneratePageContent,
  type WikiPage,
} from '@/services/storage/wiki'
import { listEntitiesForEntry, countEntriesForEntity } from '@/services/storage/entities'
import { listReframesForBelief } from '@/services/storage/reframes'
import { type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ synthesizePage: jest.fn(), regeneratePage: jest.fn() }))
jest.mock('@/services/storage/wiki', () => ({
  getPage: jest.fn(),
  getPageByTitle: jest.fn(),
  createPage: jest.fn(),
  updatePage: jest.fn(),
  regeneratePageContent: jest.fn(),
}))
jest.mock('@/services/storage/entities', () => ({
  listEntitiesForEntry: jest.fn(),
  countEntriesForEntity: jest.fn(),
}))
jest.mock('@/services/storage/reframes', () => ({ listReframesForBelief: jest.fn() }))

const mockSynth = synthesizePage as jest.Mock
const mockRegen = regeneratePage as jest.Mock
const mockRegenContent = regeneratePageContent as jest.Mock
const mockGetByTitle = getPageByTitle as jest.Mock
const mockGetPage = getPage as jest.Mock
const mockCreate = createPage as jest.Mock
const mockUpdate = updatePage as jest.Mock
const mockListEntities = listEntitiesForEntry as jest.Mock
const mockCountEntity = countEntriesForEntity as jest.Mock
const mockListReframes = listReframesForBelief as jest.Mock

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: 0,
  mood: 2,
  situation: 'a meeting',
  thought: 'I will fail',
  behavior: null,
  closing_note: null,
  emotion: 'anxiety',
  named_emotion: null,
  energy: null,
  distortion: 'catastrophizing',
  mood_score: 0.2,
  topic: null,
  tagged_at: 1,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  source: 'journal',
  ...over,
})

describe('candidateTopics', () => {
  it('derives title-cased emotion + distortion topics', () => {
    expect(candidateTopics(entry())).toEqual([
      { title: 'Anxiety', category: 'emotion' },
      { title: 'Catastrophizing', category: 'distortion' },
    ])
  })

  it('skips distortion "none" and untagged entries', () => {
    expect(candidateTopics(entry({ distortion: 'none' }))).toEqual([
      { title: 'Anxiety', category: 'emotion' },
    ])
    expect(candidateTopics(entry({ emotion: null, distortion: null }))).toEqual([])
  })

  it('adds a de-duplicated theme topic when provided', () => {
    const topics = candidateTopics(entry({ distortion: 'none' }), 'Work')
    expect(topics).toEqual([
      { title: 'Anxiety', category: 'emotion' },
      { title: 'Work', category: 'theme' },
    ])
    // a theme equal to an existing topic is de-duped
    const deduped = candidateTopics(entry({ distortion: 'none' }), 'anxiety')
    expect(deduped).toEqual([{ title: 'Anxiety', category: 'emotion' }])
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
    mockListEntities.mockResolvedValue(ok([])) // no entities by default
    mockCountEntity.mockResolvedValue(ok(0))
    mockListReframes.mockReset().mockResolvedValue(ok([])) // no reframes by default
  })

  it('creates a new page when none exists, then synthesizes and updates it', async () => {
    mockGetByTitle.mockResolvedValue(ok(null))
    mockCreate.mockImplementation(async (input) => ok({ id: 'p', title: input.title, category: input.category, content: '' }))

    const result = await updateWikiForEntry(entry({ distortion: 'none' }))

    expect(mockCreate).toHaveBeenCalledWith({ title: 'Anxiety', category: 'emotion' })
    expect(mockUpdate).toHaveBeenCalledWith('p', 'synthesized content')
    expect(result.success && result.data).toEqual(['Anxiety'])
  })

  it('updates an existing page without recreating it', async () => {
    mockGetByTitle.mockResolvedValue(ok({ id: 'p9', title: 'Anxiety', category: 'emotion', content: 'old' }))

    const result = await updateWikiForEntry(entry({ distortion: 'none' }))

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith('p9', 'synthesized content')
    expect(result.success && result.data).toEqual(['Anxiety'])
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

    const result = await updateWikiForEntry(entry({ emotion: null, distortion: 'none' }), 'Job pressure')

    // Built on the survivor's content + title, and wrote to the survivor's id.
    expect(mockSynth).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Work stress', existingContent: 'live take' })
    )
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith('survivor', 'synthesized content')
    expect(result.success && result.data).toEqual(['Job pressure'])
  })

  it('regenerates a dropped page from scratch (ignores its dismissed content)', async () => {
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'p9', title: 'Anxiety', category: 'emotion', content: 'wrong old take', dismissed_at: 123 })
    )

    await updateWikiForEntry(entry({ distortion: 'none' }))

    // synthesized fresh — the dismissed content is NOT fed back in
    expect(mockSynth).toHaveBeenCalledWith(expect.objectContaining({ existingContent: '' }))
    expect(mockUpdate).toHaveBeenCalledWith('p9', 'synthesized content') // updatePage clears the flag
  })

  it('builds on existing content for an active (non-dismissed) page', async () => {
    mockGetByTitle.mockResolvedValue(
      ok({ id: 'p9', title: 'Anxiety', category: 'emotion', content: 'good prior take', dismissed_at: null })
    )

    await updateWikiForEntry(entry({ distortion: 'none' }))

    expect(mockSynth).toHaveBeenCalledWith(expect.objectContaining({ existingContent: 'good prior take' }))
  })

  it('skips a page when synthesis fails (best-effort)', async () => {
    mockGetByTitle.mockResolvedValue(ok({ id: 'p', title: 'Anxiety', category: 'emotion', content: '' }))
    mockSynth.mockResolvedValue(err('SYNTH_INFERENCE_FAILED', 'down'))

    const result = await updateWikiForEntry(entry({ distortion: 'none' }))

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(result.success && result.data).toEqual([])
  })

  it('does not create a new page when synthesis fails (no blank shell)', async () => {
    mockGetByTitle.mockResolvedValue(ok(null)) // page does not exist yet
    mockSynth.mockResolvedValue(err('SYNTH_INFERENCE_FAILED', 'down'))
    mockCreate.mockImplementation(async (input) =>
      ok({ id: 'p', title: input.title, category: input.category, content: '' })
    )

    const result = await updateWikiForEntry(entry({ distortion: 'none' }))

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

    // First mention: count = 1 → no page for Sarah (only the emotion page)
    mockCountEntity.mockResolvedValue(ok(1))
    const first = await updateWikiForEntry(entry({ distortion: 'none' }))
    expect(first.success && first.data).toEqual(['Anxiety'])
    expect(mockCreate).not.toHaveBeenCalledWith({ title: 'Sarah', category: 'person' })

    // Second mention: count = 2 → Sarah earns a page
    mockCountEntity.mockResolvedValue(ok(2))
    const second = await updateWikiForEntry(entry({ distortion: 'none' }))
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Sarah', category: 'person' })
    expect(second.success && second.data).toEqual(['Anxiety', 'Sarah'])
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

    await updateWikiForEntry(entry({ distortion: 'none' }))

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
    mockGetByTitle.mockResolvedValue(ok({ id: 'p9', title: 'Anxiety', category: 'emotion', content: 'old' }))

    await updateWikiForEntry(entry({ distortion: 'none' }))

    expect(mockListReframes).not.toHaveBeenCalled()
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

    const res = await lineageForEntry(entry())

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
