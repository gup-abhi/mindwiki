import { renderHook, act, waitFor } from '@testing-library/react-native'

import { useConversation } from '@/hooks/useConversation'
import * as conversation from '@/services/wiki/conversation'
import * as chat from '@/services/storage/chat'
import * as graph from '@/services/storage/graph'
import * as wikiPages from '@/services/storage/wiki'
import * as pipeline from '@/services/pipeline'
import { useChatStore } from '@/store/chat.store'

// useConversation uses expo-router's useFocusEffect, which needs a navigation
// context. Tests don't care about focus — run the callback once on mount.
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    require('react').useEffect(() => {
      const cleanup = cb()
      return typeof cleanup === 'function' ? cleanup : undefined
    }, [])
  },
}))

jest.mock('@/services/llm/model-manager', () => ({
  areModelsReady: jest.fn().mockResolvedValue(true),
  ensureEmbedModel: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/services/crisis/detector', () => ({
  hasCrisisKeyword: jest.fn().mockReturnValue(false),
}))
jest.mock('@/services/wiki/embeddings', () => ({
  backfillStaleEmbeddings: jest.fn().mockResolvedValue({ embedded: 0, failed: 0 }),
}))
jest.mock('@/services/wiki/belief-snap', () => ({
  backfillBeliefEmbeddings: jest.fn().mockResolvedValue({ embedded: 0, failed: 0 }),
}))
jest.mock('@/services/wiki/query', () => ({
  suggestedQuestions: jest.fn().mockReturnValue([]),
}))

// Defer `respond` so we can observe the in-flight state mid-generation. Each
// call to respond() returns a new promise; the test resolves them in order.
// sources here are empty WikiPage arrays — the hook just maps them into the
// store's UIMessage.sources ({id, title}), which the test doesn't assert.
let resolvers: Array<(v: { success: true; data: conversation.ConversationReply }) => void> = []
const respondMock = jest.spyOn(conversation, 'respond')
respondMock.mockImplementation(
  () =>
    new Promise((resolve) => {
      resolvers.push((v) => resolve(v))
    })
)

function resolveNext(text: string) {
  const r = resolvers.shift()
  if (!r) throw new Error('no pending respond() call to resolve')
  r({ success: true, data: { text, sources: [] } })
}

jest.spyOn(chat, 'createConversation').mockResolvedValue({
  success: true,
  data: { id: 'conv-1', title: null, created_at: 0, updated_at: 0, summary: '', summary_count: 0 },
})
jest.spyOn(chat, 'listMessages').mockResolvedValue({ success: true, data: [] })
jest.spyOn(chat, 'getConversation').mockResolvedValue({
  success: true,
  data: { id: 'conv-1', title: null, created_at: 0, updated_at: 0, summary: '', summary_count: 0 },
})
jest.spyOn(chat, 'listConversations').mockResolvedValue({ success: true, data: [] })
jest.spyOn(chat, 'appendMessage').mockResolvedValue({
  success: true,
  data: {
    id: 'm',
    conversation_id: 'c',
    role: 'assistant',
    content: '',
    sources: [],
    crisis_tier: null,
    created_at: 0,
  },
})
jest.spyOn(wikiPages, 'listPages').mockResolvedValue({ success: true, data: [] })
jest.spyOn(graph, 'listNodes').mockResolvedValue({ success: true, data: [] })
jest.spyOn(graph, 'listEdges').mockResolvedValue({ success: true, data: [] })

jest.spyOn(pipeline, 'queueReflectCapture').mockImplementation(() => {})
jest.spyOn(pipeline, 'flushReflectCaptures').mockResolvedValue(undefined)
jest.spyOn(pipeline, 'pauseReflectCaptures').mockImplementation(() => {})
jest.spyOn(pipeline, 'resumeReflectCaptures').mockImplementation(() => {})

beforeEach(() => {
  respondMock.mockClear()
  resolvers = []
  useChatStore.getState().reset()
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('useConversation — duplicate-reply race', () => {
  it('retry while a generation is in flight is a no-op', async () => {
    const { result } = renderHook(() => useConversation())

    // Kick off a turn. send() returns a promise that won't resolve until
    // respond() does; don't await it. Use act() without await to fire-and-forget.
    act(() => {
      void result.current.send('how do I cope?')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    // Simulate the state the user sees on reopening a mid-reply thread: the
    // thread ends on the user message because the in-flight reply hasn't
    // persisted yet, and load() reset sending=false.
    jest.spyOn(chat, 'listMessages').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'u1',
          conversation_id: 'conv-1',
          role: 'user',
          content: 'how do I cope?',
          sources: [],
          crisis_tier: null,
          created_at: 0,
        },
      ],
    })
    await act(async () => {
      await result.current.loadConversation('conv-1')
    })

    // The in-flight set prevents loadConversation from offering retry; the
    // thread is marked sending instead. (See the dedicated test below for the
    // full assertion — we just need the retry guard to engage here.)
    expect(useChatStore.getState().sending).toBe(true)
    expect(useChatStore.getState().messages.some((m) => m.failed)).toBe(false)

    // Tap "Try again" on the (non-existent) placeholder — retry() must be a no-op
    // while a generation is in flight. respond() must NOT be called again.
    await act(async () => {
      await result.current.retry()
    })
    expect(respondMock).toHaveBeenCalledTimes(1)

    // Resolve the original so the test doesn't leak.
    await act(async () => {
      resolveNext('reply-one')
    })
  })

  it('loadConversation on an in-flight thread marks sending and adds no retry placeholder', async () => {
    const { result } = renderHook(() => useConversation())
    act(() => {
      void result.current.send('mid-flight query')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    // Simulate the DB state the user would see on reopen: only the user
    // message is persisted (the reply is still in flight).
    jest.spyOn(chat, 'listMessages').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'u1',
          conversation_id: 'conv-1',
          role: 'user',
          content: 'mid-flight query',
          sources: [],
          crisis_tier: null,
          created_at: 0,
        },
      ],
    })

    await act(async () => {
      await result.current.loadConversation('conv-1')
    })

    const state = useChatStore.getState()
    expect(state.sending).toBe(true)
    expect(state.messages.some((m) => m.failed)).toBe(false)

    await act(async () => {
      resolveNext('reply-one')
    })
  })

  it('loadConversation on a NOT-in-flight thread (true crash) does offer a retry placeholder', async () => {
    const { result } = renderHook(() => useConversation())

    // No generation in flight. DB has just the user message (reply died).
    jest.spyOn(chat, 'listMessages').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'u1',
          conversation_id: 'conv-1',
          role: 'user',
          content: 'I lost my train of thought',
          sources: [],
          crisis_tier: null,
          created_at: 0,
        },
      ],
    })

    await act(async () => {
      await result.current.loadConversation('conv-1')
    })

    const state = useChatStore.getState()
    // The user message is present plus the REPLY_INTERRUPTED placeholder.
    expect(state.messages.some((m) => m.failed)).toBe(true)
    expect(state.messages.find((m) => m.role === 'user')?.content).toBe('I lost my train of thought')
    expect(state.sending).toBe(false)
  })

  it('a superseded generation does not land a duplicate reply', async () => {
    const appendSpy = jest.spyOn(chat, 'appendMessage')
    const { result } = renderHook(() => useConversation())

    // First turn (gen #1) — deferred.
    act(() => {
      void result.current.send('first')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    // Simulate "user reopened thread and tapped retry": thread has user message
    // and a failed placeholder (so retry() will see a non-null retryRef).
    jest.spyOn(chat, 'listMessages').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'u1',
          conversation_id: 'conv-1',
          role: 'user',
          content: 'first',
          sources: [],
          crisis_tier: null,
          created_at: 0,
        },
        {
          id: 'a1',
          conversation_id: 'conv-1',
          role: 'assistant',
          content: 'placeholder',
          sources: [],
          crisis_tier: null,
          created_at: 0,
        },
      ],
    })
    await act(async () => {
      await result.current.loadConversation('conv-1')
    })

    // While gen #1 is still in flight, retry should be blocked (in-flight check).
    await act(async () => {
      await result.current.retry()
    })
    expect(respondMock).toHaveBeenCalledTimes(1)

    // Resolve gen #1. Its reply lands. retryRef was cleared.
    await act(async () => {
      resolveNext('reply-one')
    })

    // Only gen #1's assistant message has been persisted.
    const assistantPersists = appendSpy.mock.calls.filter(
      (c) => (c[0] as { role?: string }).role === 'assistant'
    )
    expect(assistantPersists).toHaveLength(1)
  })
})

describe('useConversation — cross-conversation summary seed', () => {
  const RECENT = Date.now() - 60_000 // within the past-week window

  it('seeds a new conversation with summaries from recent conversations', async () => {
    jest.spyOn(chat, 'listConversations').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'prev-1',
          title: 'Last chat',
          created_at: 0,
          updated_at: RECENT,
          summary: 'They were dreading a Thursday review at work.',
          summary_count: 3,
        },
      ],
    })

    const { result } = renderHook(() => useConversation())
    // Wait for the focus effect's async load — it fetches conversations + pages.
    await waitFor(() => expect(result.current.history.length).toBe(1))

    // First message of a brand-new conversation — triggers the seed logic.
    act(() => {
      void result.current.send('hello')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    // The store's summary should be seeded from the prior conversation.
    expect(useChatStore.getState().summary).toContain('From a previous conversation')
    expect(useChatStore.getState().summary).toContain('dreading a Thursday review')

    await act(async () => {
      resolveNext('reply')
    })
  })

  it('seeds from up to 3 recent conversations, oldest-first', async () => {
    jest.spyOn(chat, 'listConversations').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'prev-3',
          title: 'Third',
          created_at: 0,
          updated_at: RECENT,
          summary: 'Work stress and deadlines.',
          summary_count: 5,
        },
        {
          id: 'prev-2',
          title: 'Second',
          created_at: 0,
          updated_at: RECENT - 1000,
          summary: 'Relationship anxiety flared up.',
          summary_count: 3,
        },
        {
          id: 'prev-1',
          title: 'First',
          created_at: 0,
          updated_at: RECENT - 2000,
          summary: 'Sleep has been bad.',
          summary_count: 7,
        },
      ],
    })

    const { result } = renderHook(() => useConversation())
    await waitFor(() => expect(result.current.history.length).toBe(3))

    act(() => {
      void result.current.send('hello')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    const summary = useChatStore.getState().summary
    // Oldest first in the combined string (prev-1 → prev-2 → prev-3)
    const firstIdx = summary.indexOf('Sleep has been bad.')
    const secondIdx = summary.indexOf('Relationship anxiety')
    const thirdIdx = summary.indexOf('Work stress')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(secondIdx).toBeGreaterThan(firstIdx)
    expect(thirdIdx).toBeGreaterThan(secondIdx)
    // Each gets its own "From a previous conversation" label
    const labels = summary.match(/From a previous conversation/g)
    expect(labels).toHaveLength(3)

    await act(async () => {
      resolveNext('reply')
    })
  })

  it('falls back to last 3 ever when nothing is from the past week', async () => {
    const OLD = Date.now() - 365 * 24 * 60 * 60 * 1000 // 1 year ago

    jest.spyOn(chat, 'listConversations').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'prev-1',
          title: 'Old chat',
          created_at: 0,
          updated_at: OLD,
          summary: 'They were anxious about a presentation.',
          summary_count: 4,
        },
      ],
    })

    const { result } = renderHook(() => useConversation())
    await waitFor(() => expect(result.current.history.length).toBe(1))

    act(() => {
      void result.current.send('hello')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    expect(useChatStore.getState().summary).toContain('From a previous conversation')
    expect(useChatStore.getState().summary).toContain('anxious about a presentation')

    await act(async () => {
      resolveNext('reply')
    })
  })

  it('does not seed summary when there is no prior conversation', async () => {
    const { result } = renderHook(() => useConversation())
    // listConversations returns [] by default — no prior history.

    act(() => {
      void result.current.send('first')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    expect(useChatStore.getState().summary).toBe('')

    await act(async () => {
      resolveNext('reply')
    })
  })

  it('does not seed summary when prior conversations have empty summaries', async () => {
    jest.spyOn(chat, 'listConversations').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'prev-1',
          title: 'Empty chat',
          created_at: 0,
          updated_at: RECENT,
          summary: '',
          summary_count: 0,
        },
      ],
    })

    const { result } = renderHook(() => useConversation())
    await waitFor(() => expect(result.current.history.length).toBe(1))

    act(() => {
      void result.current.send('first')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    expect(useChatStore.getState().summary).toBe('')

    await act(async () => {
      resolveNext('reply')
    })
  })

  it('does not seed summary from the current conversation itself', async () => {
    // The history list already includes the conversation createConversation
    // will return. The seed logic must filter it out by id so a conversation
    // never seeds from its own summary (pointless and would duplicate context).
    jest.spyOn(chat, 'listConversations').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'conv-1',
          title: 'Already in history',
          created_at: 0,
          updated_at: RECENT,
          summary: 'This should not be used.',
          summary_count: 5,
        },
      ],
    })

    const { result } = renderHook(() => useConversation())
    await waitFor(() => expect(result.current.history.length).toBe(1))

    act(() => {
      void result.current.send('hello')
    })
    await waitFor(() => expect(respondMock).toHaveBeenCalledTimes(1))

    // conv-1 filtered out (c.id !== conversationId) and no other prior
    // conversation exists, so summary stays empty.
    expect(useChatStore.getState().summary).toBe('')

    await act(async () => {
      resolveNext('reply')
    })
  })
})
