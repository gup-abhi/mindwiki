import { renderHook, act } from '@testing-library/react-native'

import { useGuidedPath } from '@/hooks/useGuidedPath'
import { GUIDED_PATHS } from '@/lib/guided-paths'
import { deepenReflection } from '@/services/llm/deep-model'
import { capturePathAnswers } from '@/services/pipeline'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ deepenReflection: jest.fn() }))
jest.mock('@/services/pipeline', () => ({ capturePathAnswers: jest.fn() }))

const mockDeepen = deepenReflection as jest.Mock
const mockCapture = capturePathAnswers as jest.Mock

const pathId = GUIDED_PATHS[0].id
const noCrisis = { tier: 0, confidence: 0, keywordMatch: false }

describe('useGuidedPath', () => {
  beforeEach(() => {
    mockDeepen.mockReset().mockResolvedValue(ok('And what’s underneath that?'))
    mockCapture.mockReset().mockResolvedValue(noCrisis)
  })

  it('loads the path and starts on the first step', () => {
    const { result } = renderHook(() => useGuidedPath(pathId))
    expect(result.current.path?.id).toBe(pathId)
    expect(result.current.stepIndex).toBe(0)
    expect(result.current.isFirst).toBe(true)
  })

  it('records an answer per step and navigates without bleeding answers across steps', () => {
    const { result } = renderHook(() => useGuidedPath(pathId))
    act(() => result.current.setAnswer('step one answer'))
    expect(result.current.answer).toBe('step one answer')
    act(() => result.current.next())
    expect(result.current.stepIndex).toBe(1)
    expect(result.current.answer).toBe('') // a fresh field for step 2
    act(() => result.current.back())
    expect(result.current.answer).toBe('step one answer') // step 1 preserved
  })

  it('fetches a follow-up question only when the current answer has text', async () => {
    const { result } = renderHook(() => useGuidedPath(pathId))
    await act(async () => {
      await result.current.deepen()
    })
    expect(mockDeepen).not.toHaveBeenCalled() // empty answer → no call
    expect(result.current.followUp).toBeNull()

    act(() => result.current.setAnswer('work has been relentless'))
    await act(async () => {
      await result.current.deepen()
    })
    expect(mockDeepen).toHaveBeenCalledTimes(1)
    expect(result.current.followUp).toBe('And what’s underneath that?')
  })

  it('does not set a follow-up when the model fails', async () => {
    mockDeepen.mockResolvedValue(err('DEEPEN_INFERENCE_FAILED', 'down'))
    const { result } = renderHook(() => useGuidedPath(pathId))
    act(() => result.current.setAnswer('something'))
    await act(async () => {
      await result.current.deepen()
    })
    expect(result.current.followUp).toBeNull()
  })

  it('finish captures every answer and returns the crisis assessment', async () => {
    mockCapture.mockResolvedValue({ tier: 3, confidence: 0.9, keywordMatch: true })
    const { result } = renderHook(() => useGuidedPath(pathId))
    act(() => result.current.setAnswer('first'))

    let crisis
    await act(async () => {
      crisis = await result.current.finish()
    })
    expect(mockCapture).toHaveBeenCalledWith(expect.arrayContaining(['first']))
    expect(crisis).toEqual({ tier: 3, confidence: 0.9, keywordMatch: true })
  })
})
