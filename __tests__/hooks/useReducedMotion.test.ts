import { act, renderHook, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo } from 'react-native'

import { useReducedMotion } from '@/hooks/useReducedMotion'

describe('useReducedMotion', () => {
  const remove = jest.fn()
  const addEventListener = jest.spyOn(AccessibilityInfo, 'addEventListener')
  const isReduceMotionEnabled = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled')

  beforeEach(() => {
    remove.mockClear()
    addEventListener.mockReturnValue({ remove } as never)
    isReduceMotionEnabled.mockResolvedValue(false)
  })

  afterAll(() => {
    addEventListener.mockRestore()
    isReduceMotionEnabled.mockRestore()
  })

  it('hydrates the OS preference and listens for changes', async () => {
    let listener: ((enabled: boolean) => void) | undefined
    addEventListener.mockImplementation((_event, callback) => {
      listener = callback as unknown as (enabled: boolean) => void
      return { remove } as never
    })
    isReduceMotionEnabled.mockResolvedValue(true)

    const { result } = renderHook(() => useReducedMotion())

    await waitFor(() => expect(result.current).toBe(true))
    act(() => listener?.(false))
    expect(result.current).toBe(false)
  })

  it('removes the preference listener on unmount', () => {
    const { unmount } = renderHook(() => useReducedMotion())
    unmount()
    expect(remove).toHaveBeenCalled()
  })
})
