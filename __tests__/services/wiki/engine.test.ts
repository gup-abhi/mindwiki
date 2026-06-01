import { candidateTopics, updateWikiForEntry } from '@/services/wiki/engine'
import { synthesizePage } from '@/services/llm/deep-model'
import { getPageByTitle, createPage, updatePage } from '@/services/storage/wiki'
import { type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ synthesizePage: jest.fn() }))
jest.mock('@/services/storage/wiki', () => ({
  getPageByTitle: jest.fn(),
  createPage: jest.fn(),
  updatePage: jest.fn(),
}))

const mockSynth = synthesizePage as jest.Mock
const mockGetByTitle = getPageByTitle as jest.Mock
const mockCreate = createPage as jest.Mock
const mockUpdate = updatePage as jest.Mock

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
  tagged_at: 1,
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
})

describe('updateWikiForEntry', () => {
  beforeEach(() => {
    mockSynth.mockReset()
    mockGetByTitle.mockReset()
    mockCreate.mockReset()
    mockUpdate.mockReset()
    mockSynth.mockResolvedValue(ok('synthesized content'))
    mockUpdate.mockResolvedValue(ok({}))
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
})
