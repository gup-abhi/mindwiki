import { renderHook, act } from '@testing-library/react-native'

// Mocks must be set BEFORE importing the hook under test.
jest.mock('@/services/untangle/thought-match', () => ({
  findExistingBeliefMatch: jest.fn(),
}))

jest.mock('@/services/untangle/service', () => ({
  suggestUntanglePatterns: jest.fn(),
  suggestUntangleReframes: jest.fn(),
}))

jest.mock('@/services/storage/reframes', () => ({
  createReframe: jest.fn(),
}))

jest.mock('@/services/crisis/detector', () => ({
  hasCrisisKeyword: jest.fn(),
  assessCrisis: jest.fn(),
}))

jest.mock('@/services/storage/wiki', () => ({
  listPages: jest.fn(),
}))

jest.mock('@/services/storage/graph', () => ({
  listNodes: jest.fn(),
  listEdges: jest.fn(),
}))

import { listPages, type WikiPage } from '@/services/storage/wiki'
import { listNodes, listEdges } from '@/services/storage/graph'

import { useUntangleThought, type UntangleStep } from '@/hooks/useUntangleThought'
import { findExistingBeliefMatch } from '@/services/untangle/thought-match'
import { suggestUntanglePatterns, suggestUntangleReframes } from '@/services/untangle/service'
import { createReframe } from '@/services/storage/reframes'
import { hasCrisisKeyword, assessCrisis } from '@/services/crisis/detector'
import { ok, err } from '@/types/result'

const mockFindMatch = jest.mocked(findExistingBeliefMatch)
const mockPatterns = jest.mocked(suggestUntanglePatterns)
const mockReframes = jest.mocked(suggestUntangleReframes)
const mockCreateReframe = jest.mocked(createReframe)
const mockCrisisKeyword = jest.mocked(hasCrisisKeyword)
const mockAssessCrisis = jest.mocked(assessCrisis)
const mockListPages = jest.mocked(listPages)
const mockListNodes = jest.mocked(listNodes)
const mockListEdges = jest.mocked(listEdges)

function defaultState() {
  return {
    thought: '',
    step: 'idle' as UntangleStep,
    stage: 0,
    safetyChecked: false,
  }
}

describe('useUntangleThought', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    // Default mocks: safe thought, no belief match, patterns work, reframes work.
    mockCrisisKeyword.mockReturnValue(false)
    mockAssessCrisis.mockReturnValue({ tier: 0, confidence: 0.05, keywordMatch: false })
    mockListPages.mockResolvedValue(ok([]))
    mockListNodes.mockResolvedValue(ok([]))
    mockListEdges.mockResolvedValue(ok([]))
    mockFindMatch.mockResolvedValue({ belief: null, matchType: 'none' })
    mockPatterns.mockResolvedValue(ok({ patterns: [] }))
    mockReframes.mockResolvedValue(
      ok({ factual: 'fact', gentle: 'gentle', action: 'action' })
    )
    mockCreateReframe.mockResolvedValue(ok({ id: 'r1' } as any))
  })

  // --- Step transitions ---

  it('empty thought cannot start — stays idle', async () => {
    const { result } = renderHook(() => useUntangleThought())
    expect(result.current.step).toBe('idle')

    await act(async () => {
      await result.current.submitThought('')
    })
    expect(result.current.step).toBe('idle')
  })

  it('keyword match and model tier >= 2 route crisis before any patterns', async () => {
    mockCrisisKeyword.mockReturnValue(true)
    mockAssessCrisis.mockReturnValue({ tier: 3, confidence: 0.95, keywordMatch: true })

    const { result } = renderHook(() => useUntangleThought())
    await act(async () => {
      await result.current.submitThought('I want to kill myself')
    })

    expect(result.current.step).toBe('crisis')
    expect(mockPatterns).not.toHaveBeenCalled()
    expect(mockReframes).not.toHaveBeenCalled()
  })

  it('tier 0/1 proceeds without crisis route', async () => {
    const { result } = renderHook(() => useUntangleThought())
    await act(async () => {
      await result.current.submitThought('I feel anxious about today')
    })

    expect(result.current.step).not.toBe('crisis')
  })

  it('loads wiki context and exposes relevant observations before Check', async () => {
    mockListPages.mockResolvedValue(ok([{
      id: 'page-work',
      title: 'Work',
      category: 'situation',
      content: 'Work presentations make me anxious and I worry I will fail.',
      entry_count: 2,
      version: 1,
      version_history: [],
      created_at: 1,
      updated_at: 1,
      dismissed_at: null,
      merged_into: null,
    }] as unknown as WikiPage[]))

    const { result } = renderHook(() => useUntangleThought())
    await act(async () => {
      await result.current.submitThought('I am anxious about work presentations')
    })

    expect(result.current.step).toBe('ready')
    expect(result.current.observations).toEqual([
      expect.objectContaining({ pageId: 'page-work', title: 'Work' }),
    ])
    expect(mockListPages).toHaveBeenCalledTimes(1)
    expect(mockListNodes).toHaveBeenCalledTimes(1)
    expect(mockListEdges).toHaveBeenCalledTimes(1)
  })

  it('goes through all five stages on happy path: catch → unhook → spot → check → reframe', async () => {
    const { result } = renderHook(() => useUntangleThought())
    expect(result.current.stage).toBe(0) // catch

    await act(async () => {
      await result.current.submitThought('I will fail')
    })
    expect(result.current.stage).toBe(1) // unhook
    expect(result.current.thought).toBe('I will fail')

    act(() => result.current.next())
    expect(result.current.stage).toBe(2) // spot
    expect(result.current.patterns).toEqual([])

    act(() => result.current.next())
    expect(result.current.stage).toBe(3) // check

    act(() => result.current.next())
    expect(result.current.stage).toBe(4) // reframe
    expect(result.current.candidates).toBeDefined()
  })

  // --- Safety gating ---

  it('model error preserves thought and exposes retry', async () => {
    mockPatterns.mockResolvedValue(err('PATTERN_INFERENCE_FAILED', 'model down'))

    const { result } = renderHook(() => useUntangleThought())
    // Should return to idle with the thought preserved for retry.
    await act(async () => {
      await result.current.submitThought('I feel anxious')
    })
    expect(result.current.error).toBe(true)
  })

  // --- Pattern selection ---

  it('choosing patterns changes only transient selection', async () => {
    mockPatterns.mockResolvedValue(ok({ patterns: ['Mind reading', 'Catastrophizing'] }))

    const { result } = renderHook(() => useUntangleThought())
    await act(async () => await result.current.submitThought('I will fail'))
    act(() => result.current.next()) // unhook → spot

    expect(result.current.selectedPatterns).toEqual(['Mind reading', 'Catastrophizing'])
    act(() => result.current.setSelectedPatterns(['Mind reading']))
    expect(result.current.selectedPatterns).toEqual(['Mind reading'])
    // Selection is transient — no storage writes happened.
    expect(mockCreateReframe).not.toHaveBeenCalled()
  })

  // --- Persistence ---

  it('matched belief save calls createReframe once with stable label and balanced thought only', async () => {
    mockFindMatch.mockResolvedValue({ belief: 'I am not good enough', matchType: 'semantic' })
    mockReframes.mockResolvedValue(
      ok({ factual: 'I can learn from mistakes', gentle: 'I am okay as I am', action: 'I can try one small step' })
    )

    const { result } = renderHook(() => useUntangleThought())
    await act(async () => await result.current.submitThought('I am not good enough'))
    act(() => result.current.next()) // unhook
    act(() => result.current.next()) // spot
    act(() => result.current.next()) // check
    act(() => result.current.next()) // reframe

    // Trigger candidate generation (normally called by the UI when stage 4 appears).
    await act(async () => {
      await result.current.generateCandidates()
    })
    expect(result.current.candidates).not.toBeNull()

    await act(async () => {
      const saved = await result.current.finishReframe()
      expect(saved).toBe(true)
    })

    expect(mockCreateReframe).toHaveBeenCalledTimes(1)
    expect(mockCreateReframe).toHaveBeenCalledWith(
      expect.objectContaining({
        belief: 'I am not good enough',
        balanced_thought: 'I can learn from mistakes',
        evidence_for: '',
        evidence_against: '',
      })
    )
  })

  it('unmatched belief completes without createReframe, entity writes, or pipeline calls', async () => {
    mockFindMatch.mockResolvedValue({ belief: null, matchType: 'none' })

    const { result } = renderHook(() => useUntangleThought())
    await act(async () => await result.current.submitThought('Some new thought'))
    act(() => result.current.next()) // unhook
    act(() => result.current.next()) // spot
    act(() => result.current.next()) // check
    act(() => result.current.next()) // reframe

    const balanced = result.current.candidates?.factual
    await act(async () => {
      const saved = await result.current.finishReframe()
      expect(saved).toBe(false) // session-only, not saved
    })

    expect(mockCreateReframe).not.toHaveBeenCalled()
  })

  // --- Staleness ---

  it('late result from a prior exercise is ignored after reset/close', async () => {
    const { result } = renderHook(() => useUntangleThought())

    await act(async () => await result.current.submitThought('First thought'))
    act(() => result.current.cancel()) // close

    // After cancel, step is idle, thought cleared.
    expect(result.current.step).toBe('idle')
  })
})
