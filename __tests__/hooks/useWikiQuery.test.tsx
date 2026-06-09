import { renderHook, act, waitFor } from '@testing-library/react-native'

import { useWikiQuery } from '@/hooks/useWikiQuery'
import { areModelsReady } from '@/services/llm/model-manager'
import { listEntries } from '@/services/storage/entries'
import { listPages } from '@/services/storage/wiki'
import { answerQuestion } from '@/services/wiki/query'
import { ok } from '@/types/result'

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => require('react').useEffect(() => cb(), []),
}))
jest.mock('@/services/llm/model-manager', () => ({ areModelsReady: jest.fn() }))
jest.mock('@/services/storage/entries', () => ({ listEntries: jest.fn() }))
jest.mock('@/services/storage/wiki', () => ({ listPages: jest.fn() }))
jest.mock('@/services/wiki/query', () => ({
  answerQuestion: jest.fn(),
  suggestedQuestions: () => [],
}))

const mockReady = areModelsReady as jest.Mock
const mockAnswer = answerQuestion as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(listEntries as jest.Mock).mockResolvedValue(ok([]))
  ;(listPages as jest.Mock).mockResolvedValue(ok([]))
  mockAnswer.mockResolvedValue(ok({ answer: 'real answer', sources: [], evidenceCount: 1 }))
})

describe('useWikiQuery', () => {
  it('points at the download card when models are missing (no LLM call)', async () => {
    mockReady.mockResolvedValue(false)
    const { result } = renderHook(() => useWikiQuery())
    await act(async () => {
      await result.current.ask('why am I anxious?')
    })
    expect(result.current.answer?.answer).toMatch(/Download AI models/i)
    expect(mockAnswer).not.toHaveBeenCalled()
  })

  it('answers normally when models are ready', async () => {
    mockReady.mockResolvedValue(true)
    const { result } = renderHook(() => useWikiQuery())
    await act(async () => {
      await result.current.ask('why am I anxious?')
    })
    await waitFor(() => expect(result.current.answer?.answer).toBe('real answer'))
    expect(mockAnswer).toHaveBeenCalled()
  })

  it('drops an in-flight answer when cleared before it resolves', async () => {
    mockReady.mockResolvedValue(true)
    // Hold the answer until we decide to resolve it.
    let resolveAnswer!: (v: unknown) => void
    mockAnswer.mockReturnValue(new Promise((res) => (resolveAnswer = res)))

    const { result } = renderHook(() => useWikiQuery())
    act(() => {
      result.current.ask('why am I anxious?')
    })
    await waitFor(() => expect(result.current.asking).toBe(true))

    // User clears before the model returns.
    act(() => result.current.clear())
    expect(result.current.asking).toBe(false)

    // The late result must be ignored.
    await act(async () => {
      resolveAnswer(ok({ answer: 'stale answer', sources: [], evidenceCount: 1 }))
    })
    expect(result.current.answer).toBeNull()
  })
})
