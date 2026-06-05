import { renderHook, act, waitFor } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { useSync } from '@/hooks/useSync'
import { sync } from '@/services/sync/engine'
import { useAuthStore } from '@/store/auth.store'

jest.mock('@/services/sync/engine', () => ({ sync: jest.fn() }))

const mockSync = sync as jest.Mock
let changeHandler: (state: string) => void

beforeEach(() => {
  mockSync.mockReset()
  mockSync.mockResolvedValue({ success: true, data: { pushed: 0, pulled: 0 } })
  useAuthStore.setState({ status: 'loading', accountId: null })
  // Capture the AppState 'change' handler so we can simulate foregrounding.
  changeHandler = () => {}
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    changeHandler = handler as (state: string) => void
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
  })
})

afterEach(() => jest.restoreAllMocks())

describe('useSync', () => {
  it('does not sync while unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    renderHook(() => useSync())
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('syncs once on mount when already authenticated', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc' })
    renderHook(() => useSync())
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))
  })

  it('syncs when auth transitions to authenticated', async () => {
    renderHook(() => useSync())
    expect(mockSync).not.toHaveBeenCalled()
    act(() => useAuthStore.setState({ status: 'authenticated', accountId: 'acc' }))
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))
  })

  it('syncs again when the app returns to the foreground', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc' })
    renderHook(() => useSync())
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1)) // mount run settles

    await act(async () => {
      changeHandler('active')
    })
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(2))
  })

  it('ignores background/inactive app-state changes', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc' })
    renderHook(() => useSync())
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))

    await act(async () => {
      changeHandler('background')
    })
    expect(mockSync).toHaveBeenCalledTimes(1)
  })
})
