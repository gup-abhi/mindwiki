import { buildContext, respond, updateRunningSummary } from '@/services/wiki/conversation'
import { converseFromWiki, summarizeConversation } from '@/services/llm/deep-model'
import { setConversationSummary } from '@/services/storage/chat'
import { type ChatMessage } from '@/native/LLMBridge'
import { type GraphEdge, type GraphNode } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({
  converseFromWiki: jest.fn(),
  summarizeConversation: jest.fn(),
}))
jest.mock('@/services/storage/chat', () => ({ setConversationSummary: jest.fn() }))
const mockConverse = converseFromWiki as jest.Mock
const mockSummarize = summarizeConversation as jest.Mock
const mockSetSummary = setConversationSummary as jest.Mock

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
  dismissed_at: null,
  corrected_at: null,
  merged_into: null,
  aggregated_upto: 0,
    regrounded_upto: 0,
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
      page({ title: 'Work', content: 'anxiety anxiety anxiety deadlines', entry_count: 4 }),
      page({ title: 'Sleep', content: 'anxiety anxiety anxiety night' }),
      page({ title: 'Food', content: 'anxiety anxiety anxiety lunch' }),
      page({ title: 'Anxiety', content: long }),
    ]
    const { context, sources } = buildContext('anxiety', pages, [], [])
    expect(sources.length).toBe(3)
    expect(context.sources.length).toBe(3)
    for (const s of context.sources) expect(s.content.length).toBeLessThanOrEqual(600)
  })

  it('drops a page the message only incidentally mentions (one common word)', () => {
    const pages = [page({ title: 'Work', content: 'deadlines and a bit of anxiety today' })]
    const { context, sources } = buildContext('anxiety', pages, [], [])
    expect(sources).toEqual([])
    expect(context.sources).toEqual([])
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

  it('briefly holds a standalone reply so the typing state remains visible', async () => {
    jest.useFakeTimers()
    const onToken = jest.fn()

    try {
      const pending = respond({
        history: [],
        message: 'hello',
        pages: [],
        nodes: [],
        edges: [],
        summary: 'A rolling summary that must not affect this reply.',
      }, onToken)
      let settled = false
      void pending.then(() => { settled = true })

      await jest.advanceTimersByTimeAsync(699)
      expect(settled).toBe(false)
      expect(mockConverse).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toEqual(ok({ text: 'Hi! I’m here.', sources: [] }))
      expect(onToken).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it.each([
    ['hi', 'Hi! I’m here.'],
    ['Hello!', 'Hi! I’m here.'],
    ['hey there', 'Hi! I’m here.'],
    ['I see.', 'I’m glad that makes sense.'],
    ['I understand', 'I’m glad that makes sense.'],
    ['I can understand that', 'I’m glad that makes sense.'],
    ['that makes sense', 'I’m glad that makes sense.'],
    ['Got it!', 'I’m glad that makes sense.'],
    ['okay', 'Okay. I’m here with you.'],
    ['all right', 'Okay. I’m here with you.'],
    ['I don’t know', 'That’s okay. You don’t have to know right now.'],
    ['I’m not sure', 'That’s okay. You don’t have to know right now.'],
  ])('responds warmly to standalone expression "%s" without summary or inference', async (message, reply) => {
    const onToken = jest.fn()

    const res = await respond({
      history: [{ role: 'assistant', content: 'A summary-shaped prior reply.' }],
      message,
      pages: [page({ title: 'Work', content: 'work work work deadlines' })],
      nodes: [],
      edges: [],
      summary: 'A rolling summary that must not affect this reply.',
    }, onToken)

    expect(res).toEqual(ok({ text: reply, sources: [] }))
    expect(mockConverse).not.toHaveBeenCalled()
    expect(onToken).not.toHaveBeenCalled()
  })

  it.each([
    'hello, I had a terrible day',
    'okay but I still feel anxious',
    "I don't know what to do",
    'I see why work keeps affecting me',
    'hello Sam',
    'I was fired',
    'I feel unsafe',
  ])('keeps substantive message "%s" on the grounded model path', async (message) => {
    mockConverse.mockResolvedValue(ok('A grounded reply.'))

    await respond({ history: [], message, pages: [], nodes: [], edges: [] })

    expect(mockConverse).toHaveBeenCalledTimes(1)
  })

  it('trims history to the last 8 messages and returns grounded sources', async () => {
    mockConverse.mockResolvedValue(ok('That sounds heavy.'))
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }))
    const pages = [page({ title: 'Work', content: 'anxiety anxiety anxiety deadlines', entry_count: 3 })]

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
    await respond({ history: [], message: 'work felt difficult today', pages: [], nodes: [], edges: [] }, onToken)
    expect(mockConverse.mock.calls[0][1]).toBe(onToken)
  })

  it('forwards the rolling summary to the model', async () => {
    mockConverse.mockResolvedValue(ok('ok'))
    await respond({ history: [], message: 'work felt difficult today', pages: [], nodes: [], edges: [], summary: 'recap' })
    expect(mockConverse.mock.calls[0][0].summary).toBe('recap')
  })

  it('returns the model text unmodified — question-alternation is enforced in converseFromWiki', async () => {
    // WS1.2: respond no longer re-strips trailing questions. converseFromWiki
    // returns already-scrubbed final text (its own guard handles alternation and
    // the `!`-boundary case respond's old lastIndexOf('.') missed), so respond
    // must pass it through verbatim.
    mockConverse.mockResolvedValue(ok('That sounds tough.'))
    const history = [
      { role: 'user' as const, content: 'work was brutal' },
      { role: 'assistant' as const, content: 'What made it so hard today?' },
    ]
    const res = await respond({ history, message: 'deadlines piled up', pages: [], nodes: [], edges: [] })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.text).toBe('That sounds tough.')
  })

  it('passes the FULL history’s assistant turns as priorReplies, not just the trimmed window (WS2.D)', async () => {
    mockConverse.mockResolvedValue(ok('ok'))
    // 20 turns: assistant turn at index 1 ("old reflection") is outside the
    // 8-message trimmed window but the repeat guard must still see it.
    const history: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: i === 1 ? 'old reflection outside the window' : `m${i}`,
    }))
    await respond({ history, message: 'now', pages: [], nodes: [], edges: [] })
    const passed = mockConverse.mock.calls[0][0]
    expect(passed.priorReplies).toContain('old reflection outside the window')
  })

  it('does not touch a reply that ends with a question', async () => {
    mockConverse.mockResolvedValue(ok('I hear you. What happened next?'))
    const history = [
      { role: 'user' as const, content: 'work was brutal' },
      { role: 'assistant' as const, content: 'That sounds rough.' },
    ]
    const res = await respond({ history, message: 'deadlines', pages: [], nodes: [], edges: [] })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.text).toBe('I hear you. What happened next?')
  })

  it('propagates a model failure', async () => {
    mockConverse.mockResolvedValue(err('CONVERSE_INFERENCE_FAILED', 'down'))
    const res = await respond({ history: [], message: 'work felt difficult today', pages: [], nodes: [], edges: [] })
    expect(res.success).toBe(false)
  })

  it('sends full background once, then titles-only while retrieval is unchanged', async () => {
    mockConverse.mockResolvedValue(ok('ok'))
    const pages = [page({ title: 'Work', content: 'anxiety anxiety anxiety deadlines', entry_count: 3 })]
    const turn = [
      { role: 'user' as const, content: 'anxiety' },
      { role: 'assistant' as const, content: 'ok' },
    ]

    // Turn 1 (conversation start): full page content attached.
    await respond({ history: [], message: 'anxiety', pages, nodes: [], edges: [], conversationId: 'A' })
    const first = mockConverse.mock.calls[0][0].context
    expect(first.sources).toHaveLength(1)

    // Turn 2, same retrieval: no page prose (nothing to copy), titles only.
    const res = await respond({ history: turn, message: 'anxiety again', pages, nodes: [], edges: [], conversationId: 'A' })
    const second = mockConverse.mock.calls[1][0].context
    expect(second.sources).toEqual([])
    expect(second.knownTopics).toEqual(['Work'])
    // Chips still show the grounding pages.
    if (res.success) expect(res.data.sources.map((p) => p.title)).toEqual(['Work'])

    // Turn 3, retrieval changed: full content attaches again.
    const otherPages = [page({ title: 'Sleep', content: 'sleep sleep sleep restless nights' })]
    await respond({ history: turn, message: 'sleep', pages: otherPages, nodes: [], edges: [], conversationId: 'A' })
    const third = mockConverse.mock.calls[2][0].context
    expect(third.sources).toHaveLength(1)
    expect(third.knownTopics).toBeUndefined()
  })

  it('carries a constraint stated OUTSIDE the trimmed window into converseFromWiki (WS2.A)', async () => {
    mockConverse.mockResolvedValue(ok('That sounds so isolating.'))
    // "no one to talk to" at turn 0, then 10 more turns so it's well past the
    // 8-message recent window — the constraint must still reach the context.
    const history: ChatMessage[] = [
      { role: 'user', content: "i don't have anyone to talk to" },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'assistant' : 'user') as 'user' | 'assistant',
        content: `filler ${i}`,
      })),
    ]
    await respond({ history, message: 'still feeling it', pages: [], nodes: [], edges: [] })
    const passedContext = mockConverse.mock.calls[0][0].context
    expect(passedContext.constraints).toBeDefined()
    expect(passedContext.constraints.join(' ')).toMatch(/never suggest reaching out/i)
  })

  it('does not leak the background key across conversations (WS1.3)', async () => {
    mockConverse.mockResolvedValue(ok('ok'))
    const pages = [page({ title: 'Work', content: 'anxiety anxiety anxiety deadlines', entry_count: 3 })]

    // Turn 1 in conversation A: full background, sets A's key to "Work".
    await respond({ history: [], message: 'anxiety', pages, nodes: [], edges: [], conversationId: 'A' })
    expect(mockConverse.mock.calls[0][0].context.sources).toHaveLength(1)

    // Turn 1 in a DIFFERENT conversation B with the SAME retrieval. history is
    // empty (B's first turn), so B must get FULL background — not titles-only
    // inherited from A's module-level key.
    await respond({ history: [], message: 'anxiety', pages, nodes: [], edges: [], conversationId: 'B' })
    const bContext = mockConverse.mock.calls[1][0].context
    expect(bContext.sources).toHaveLength(1)
    expect(bContext.knownTopics).toBeUndefined()
  })
})

describe('updateRunningSummary', () => {
  const msg = (i: number): ChatMessage => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
  })

  beforeEach(() => {
    mockSummarize.mockReset()
    mockSetSummary.mockReset()
    mockSetSummary.mockResolvedValue(ok(undefined))
  })

  it('does nothing while the recent window still covers the whole thread', async () => {
    const messages = Array.from({ length: 8 }, (_, i) => msg(i)) // 8 - 8 = 0 older
    const res = await updateRunningSummary('c1', messages, { summary: '', summaryCount: 0 })
    expect(res.success && res.data).toBeNull()
    expect(mockSummarize).not.toHaveBeenCalled()
    expect(mockSetSummary).not.toHaveBeenCalled()
  })

  it('folds the newly-evicted turns into the recap and persists it', async () => {
    mockSummarize.mockResolvedValue(ok('Updated recap.'))
    const messages = Array.from({ length: 12 }, (_, i) => msg(i)) // 12 - 8 = 4 older
    const res = await updateRunningSummary('c1', messages, { summary: 'prev', summaryCount: 0 })

    expect(res.success && res.data).toEqual({ summary: 'Updated recap.', summaryCount: 4 })
    // only the four oldest were folded in, with the prior recap as the base
    expect(mockSummarize).toHaveBeenCalledWith('prev', messages.slice(0, 4))
    expect(mockSetSummary).toHaveBeenCalledWith('c1', 'Updated recap.', 4)
  })

  it('a seed count from prior conversations skips the new thread’s early turns (why seed must be 0)', async () => {
    // Regression shape for WS1.1: if a new thread is seeded with a summaryCount
    // carried over from PREVIOUS conversations (here 6), updateRunningSummary
    // treats this thread's first 6 messages as already folded — a 12-message
    // thread then evicts nothing new (target 4 ≤ 6) and those turns are lost.
    const messages = Array.from({ length: 12 }, (_, i) => msg(i))
    const res = await updateRunningSummary('c1', messages, { summary: 'seed', summaryCount: 6 })
    expect(res.success && res.data).toBeNull() // nothing folded — the bug the fix avoids
    expect(mockSummarize).not.toHaveBeenCalled()
  })

  it('with the seed count at 0, the new thread’s evicted turns are folded (the fix)', async () => {
    mockSummarize.mockResolvedValue(ok('Recap.'))
    const messages = Array.from({ length: 12 }, (_, i) => msg(i))
    const res = await updateRunningSummary('c1', messages, { summary: 'seed', summaryCount: 0 })
    expect(res.success && res.data).toEqual({ summary: 'Recap.', summaryCount: 4 })
    // Eviction starts at message 0 — no thread turns silently skipped.
    expect(mockSummarize).toHaveBeenCalledWith('seed', messages.slice(0, 4))
  })

  it('only folds turns not already covered by the existing summary', async () => {
    mockSummarize.mockResolvedValue(ok('More recap.'))
    const messages = Array.from({ length: 14 }, (_, i) => msg(i)) // target = 6, already covered 4
    const res = await updateRunningSummary('c1', messages, { summary: 'old', summaryCount: 4 })

    expect(res.success && res.data).toEqual({ summary: 'More recap.', summaryCount: 6 })
    expect(mockSummarize).toHaveBeenCalledWith('old', messages.slice(4, 6))
  })

  it('propagates a summarization failure without persisting', async () => {
    mockSummarize.mockResolvedValue(err('SUMMARY_INFERENCE_FAILED', 'down'))
    const messages = Array.from({ length: 12 }, (_, i) => msg(i))
    const res = await updateRunningSummary('c1', messages, { summary: '', summaryCount: 0 })

    expect(res.success).toBe(false)
    expect(mockSetSummary).not.toHaveBeenCalled()
  })
})
