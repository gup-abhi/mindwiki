import { contextForNode } from '@/services/graph/node-context'
import {
  listEntriesByEmotion,
  listEntriesByDistortion,
  listEntriesByTopic,
  listEntriesForEntity,
  type Entry,
} from '@/services/storage/entries'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { type GraphNode } from '@/services/storage/graph'
import { ok } from '@/types/result'

jest.mock('@/services/storage/entries', () => ({
  listEntriesByEmotion: jest.fn(async () => ({ success: true, data: [] })),
  listEntriesByDistortion: jest.fn(async () => ({ success: true, data: [] })),
  listEntriesByTopic: jest.fn(async () => ({ success: true, data: [] })),
  listEntriesForEntity: jest.fn(async () => ({ success: true, data: [] })),
}))
jest.mock('@/services/storage/wiki', () => ({
  listPages: jest.fn(async () => ({ success: true, data: [] })),
}))

const mockEmotion = listEntriesByEmotion as jest.Mock
const mockDistortion = listEntriesByDistortion as jest.Mock
const mockTopic = listEntriesByTopic as jest.Mock
const mockEntity = listEntriesForEntity as jest.Mock
const mockListPages = listPages as jest.Mock

const node = (over: Partial<GraphNode> = {}): GraphNode => ({
  id: 'n1',
  type: 'emotion',
  label: 'Anxiety',
  frequency: 4,
  created_at: 0,
  updated_at: 0,
  ...over,
})

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: 0,
  mood: 2,
  situation: 's',
  thought: 't',
  behavior: null,
  closing_note: null,
  emotion: 'anxiety',
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: 0.2,
  topic: null,
  tagged_at: 1,
  wiki_indexed_at: null,
  source: 'journal',
  ...over,
})

const page = (over: Partial<WikiPage> = {}): WikiPage => ({
  id: 'p1',
  title: 'Anxiety',
  category: 'Emotions',
  content: 'about anxiety',
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

describe('contextForNode', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmotion.mockResolvedValue(ok([]))
    mockDistortion.mockResolvedValue(ok([]))
    mockTopic.mockResolvedValue(ok([]))
    mockEntity.mockResolvedValue(ok([]))
    mockListPages.mockResolvedValue(ok([]))
  })

  it('maps each node type to the right entry lookup', async () => {
    await contextForNode(node({ type: 'emotion', label: 'Anxiety' }))
    expect(mockEmotion).toHaveBeenCalledWith('Anxiety')

    await contextForNode(node({ type: 'distortion', label: 'Catastrophizing' }))
    expect(mockDistortion).toHaveBeenCalledWith('Catastrophizing')

    await contextForNode(node({ type: 'situation', label: 'Work' }))
    expect(mockTopic).toHaveBeenCalledWith('Work')

    await contextForNode(node({ type: 'person', label: 'Mom' }))
    expect(mockEntity).toHaveBeenCalledWith('person', 'Mom')

    await contextForNode(node({ type: 'place', label: 'Office' }))
    expect(mockEntity).toHaveBeenCalledWith('place', 'Office')

    await contextForNode(node({ type: 'belief', label: 'I am not good enough' }))
    expect(mockEntity).toHaveBeenCalledWith('belief', 'I am not good enough')

    await contextForNode(node({ type: 'behavior', label: 'Avoidance' }))
    expect(mockEntity).toHaveBeenCalledWith('behavior', 'Avoidance')
  })

  it('returns the entries behind the node', async () => {
    mockEmotion.mockResolvedValue(ok([entry({ id: 'a' }), entry({ id: 'b' })]))
    const res = await contextForNode(node({ type: 'emotion' }))
    expect(res.success && res.data.entries.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('surfaces the entries behind a belief node via the entity lookup', async () => {
    mockEntity.mockResolvedValue(ok([entry({ id: 'b1' })]))
    const res = await contextForNode(node({ type: 'belief', label: 'I am a failure' }))
    expect(mockEntity).toHaveBeenCalledWith('belief', 'I am a failure')
    expect(res.success && res.data.entries.map((e) => e.id)).toEqual(['b1'])
    expect(mockEmotion).not.toHaveBeenCalled()
  })

  it('surfaces the exact same-titled page first', async () => {
    mockListPages.mockResolvedValue(
      ok([
        page({ id: 'other', title: 'Stress at work', content: 'anxiety shows up' }),
        page({ id: 'exact', title: 'Anxiety', content: 'anxiety anxiety' }),
      ])
    )
    const res = await contextForNode(node({ label: 'Anxiety' }))
    expect(res.success && res.data.pages[0].id).toBe('exact')
    expect(res.success && res.data.pages.map((p) => p.id)).toContain('other')
  })

  it('excludes dismissed pages', async () => {
    mockListPages.mockResolvedValue(
      ok([page({ id: 'gone', title: 'Anxiety', dismissed_at: 123 })])
    )
    const res = await contextForNode(node({ label: 'Anxiety' }))
    expect(res.success && res.data.pages).toEqual([])
  })

  it('still returns a context when a lookup fails', async () => {
    mockEmotion.mockResolvedValue({ success: false, error: { code: 'X', message: 'x' } })
    mockListPages.mockResolvedValue({ success: false, error: { code: 'Y', message: 'y' } })
    const res = await contextForNode(node({ type: 'emotion' }))
    expect(res.success).toBe(true)
    expect(res.success && res.data).toEqual({ entries: [], pages: [] })
  })
})
