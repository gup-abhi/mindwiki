import { renderHook, act, waitFor } from '@testing-library/react-native'

import { useRecoverySetup } from '@/hooks/useRecoverySetup'
import { getRecoveryStatus, addRecoveryPhrase } from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'

jest.mock('@/services/auth/auth.service', () => ({
  getRecoveryStatus: jest.fn(),
  addRecoveryPhrase: jest.fn(),
}))

const mockStatus = getRecoveryStatus as jest.Mock
const mockAdd = addRecoveryPhrase as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
  mockStatus.mockResolvedValue({ success: true, data: false })
})

describe('useRecoverySetup', () => {
  it('flags setup needed when the account has no recovery', async () => {
    const { result } = renderHook(() => useRecoverySetup())
    await waitFor(() => expect(result.current.needsSetup).toBe(true))
  })

  it('does not flag setup when recovery already exists', async () => {
    mockStatus.mockResolvedValue({ success: true, data: true })
    const { result } = renderHook(() => useRecoverySetup())
    await waitFor(() => expect(mockStatus).toHaveBeenCalled())
    expect(result.current.needsSetup).toBe(false)
  })

  it('does not check while unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    renderHook(() => useRecoverySetup())
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('setup surfaces the phrase; done clears it and hides the card', async () => {
    mockAdd.mockResolvedValue({ success: true, data: { recoveryPhrase: 'a b c' } })
    const { result } = renderHook(() => useRecoverySetup())
    await waitFor(() => expect(result.current.needsSetup).toBe(true))

    await act(async () => {
      await result.current.setup()
    })
    expect(result.current.phrase).toBe('a b c')

    act(() => result.current.done())
    expect(result.current.phrase).toBeNull()
    expect(result.current.needsSetup).toBe(false)
  })

  it('surfaces an error when setup fails', async () => {
    mockAdd.mockResolvedValue({ success: false, error: { code: 'X', message: 'no' } })
    const { result } = renderHook(() => useRecoverySetup())
    await waitFor(() => expect(result.current.needsSetup).toBe(true))

    await act(async () => {
      await result.current.setup()
    })
    expect(result.current.phrase).toBeNull()
    expect(result.current.error).toBeTruthy()
  })
})
