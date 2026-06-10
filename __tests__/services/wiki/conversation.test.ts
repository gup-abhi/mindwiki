import { buildContext, respond } from '@/services/wiki/conversation'
import { converseFromWiki } from '@/services/llm/deep-model'
import { type GraphEdge, type GraphNode } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ converseFromWiki: jest.fn() }))
const mockConverse = converseFromWiki as jest.Mock

const page = (over: Partial<WikiPage> = {}): WikiPage => ({
  id: Math.random().toString(36),
  title: 'Untitled',
  category: null,
  content: '',
  entry_count: 1,
  version: 1,
  version_history: [],
  created_at: 0,
  updated_at: 0,
  ...over,
})

const node = (id: string, label: string, frequency = 1): GraphNode => ({
  id,
  type: 'emotion',
  label,
  frequency,
  created_at: 0,
  updated_at: 0,
})

const edge = (source_id: string, target_id: string, weight = 1): GraphEdge => ({
  id: `${source_id}-${target_id}`,
  source_id,
  target_id,
  weight,
  created_at: 0,
  updated_at: 0,
})

describe('buildContext', () => {
  it('ranks pages, caps to three, and truncates page content', () => {
    const long = 'anxiety '.repeat(200) // > 600 chars
    const pages = [
      page({ title: 'Work', content: 'anxiety deadlines', entry_count: 4 }),
      page({ title: 'Sleep', content: 'anxiety night' }),
      page({ title: 'Food', content: 'anxiety lunch' }),
      page({ title: 'Anxiety', content: long }),
    ]
    const { context, sources } = buildContext('anxiety', pages, [], [])
    expect(sources.length).toBe(3)
    expect(context.sources.length).toBe(3)
    for (const s of context.sources) expect(s.content.length).toBeLessThanOrEqual(600)
  })

  it('adds a connection line for a source page found in the graph', () => {
    const nodes = [node('a', 'Anxiety', 5), node('w', 'Work', 9), node('s', 'Sleep', 2)]
    const edges = [edge('a', 'w'), edge('a', 's')]
    const { context } = buildContext(
      'anxiety',
      [page({ title: 'Anxiety', content: 'anxiety' })],
      nodes,
      edges
    )
    expect(context.connections).toHaveLength(1)
    // neighbors sorted by frequency: Work (9) before Sleep (2)
    expect(context.connections[0]).toBe('Anxiety often comes up with Work, Sleep.')
  })

  it('returns no connections when the page is not a graph node', () => {
    const { context } = buildContext('anxiety', [page({ title: 'Anxiety', content: 'anxiety' })], [], [])
    expect(context.connections).toEqual([])
  })
})

describe('respond', () => {
  beforeEach(() => mockConverse.mockReset())

  it('trims history to the last 8 messages and returns grounded sources', async () => {
    mockConverse.mockResolvedValue(ok('That sounds heavy.'))
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }))
    const pages = [page({ title: 'Work', content: 'anxiety deadlines', entry_count: 3 })]

    const res = await respond({ history, message: 'anxiety', pages, nodes: [], edges: [] })

    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.text).toBe('That sounds heavy.')
      expect(res.data.sources.map((p) => p.title)).toEqual(['Work'])
    }
    const passed = mockConverse.mock.calls[0][0]
    expect(passed.history).toHaveLength(8)
    expect(passed.history[0].content).toBe('m4') // oldest four dropped
    expect(passed.message).toBe('anxiety')
  })

  it('forwards the streaming callback to the model', async () => {
    mockConverse.mockResolvedValue(ok('ok'))
    const onToken = jest.fn()
    await respond({ history: [], message: 'hi', pages: [], nodes: [], edges: [] }, onToken)
    expect(mockConverse.mock.calls[0][1]).toBe(onToken)
  })

  it('propagates a model failure', async () => {
    mockConverse.mockResolvedValue(err('CONVERSE_INFERENCE_FAILED', 'down'))
    const res = await respond({ history: [], message: 'hi', pages: [], nodes: [], edges: [] })
    expect(res.success).toBe(false)
  })
})
