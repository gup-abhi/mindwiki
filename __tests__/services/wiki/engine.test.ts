import { candidateTopics, updateWikiForEntry } from '@/services/wiki/engine'
import { synthesizePage } from '@/services/llm/deep-model'
import { getPageByTitle, createPage, updatePage } from '@/services/storage/wiki'
import { listEntitiesForEntry, countEntriesForEntity } from '@/services/storage/entities'
import { type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ synthesizePage: jest.fn() }))
jest.mock('@/services/storage/wiki', () => ({
  getPageByTitle: jest.fn(),
  createPage: jest.fn(),
  updatePage: jest.fn(),
}))
jest.mock('@/services/storage/entities', () => ({
  listEntitiesForEntry: jest.fn(),
  countEntriesForEntity: jest.fn(),
}))

const mockSynth = synthesizePage as jest.Mock
const mockGetByTitle = getPageByTitle as jest.Mock
const mockCreate = createPage as jest.Mock
const mockUpdate = updatePage as jest.Mock
const mockListEntities = listEntitiesForEntry as jest.Mock
const mockCountEntity = countEntriesForEntity as jest.Mock

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: 0,
  mood: 2,
  situation: 'a meeting',
  thought: 'I will fail',
  behavior: null,
  closing_note: null,
  emotion: 'anxiety',
  distortion: 'catastrophizing',
  mood_score: 0.2,
  topic: null,
  tagged_at: 1,
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
    mockCreate.mockReset()
    mockUpdate.mockReset()
    mockListEntities.mockReset()
    mockCountEntity.mockReset()
    mockSynth.mockResolvedValue(ok('synthesized content'))
    mockUpdate.mockResolvedValue(ok({}))
    mockListEntities.mockResolvedValue(ok([])) // no entities by default
    mockCountEntity.mockResolvedValue(ok(0))
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
})
