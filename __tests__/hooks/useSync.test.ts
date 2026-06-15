import { renderHook, act, waitFor } from '@testing-library/react-native'
import { AppState } from 'react-native'
import NetInfo from '@react-native-community/netinfo'

import { useSync } from '@/hooks/useSync'
import { sync } from '@/services/sync/engine'
import { useAuthStore } from '@/store/auth.store'
import { useSyncStore } from '@/store/sync.store'

jest.mock('@/services/sync/engine', () => ({ sync: jest.fn() }))

const mockSync = sync as jest.Mock
let changeHandler: (state: string) => void
let netHandler: (state: { isConnected: boolean }) => void

beforeEach(() => {
  mockSync.mockReset()
  mockSync.mockResolvedValue({ success: true, data: { pushed: 0, pulled: 0 } })
  useAuthStore.setState({ status: 'loading', accountId: null })
  useSyncStore.setState({ revision: 0, pendingSignal: 0 })
  // Capture the AppState 'change' handler so we can simulate foregrounding.
  changeHandler = () => {}
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    changeHandler = handler as (state: string) => void
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
  })
  // Capture the NetInfo handler so we can simulate connectivity changes.
  netHandler = () => {}
  jest.spyOn(NetInfo, 'addEventListener').mockImplementation((handler) => {
    netHandler = handler as (state: { isConnected: boolean }) => void
    return jest.fn()
  })
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

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

  it('syncs when connectivity is regained (offline → online)', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc' })
    renderHook(() => useSync())
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1)) // mount run

    await act(async () => {
      netHandler({ isConnected: false }) // went offline — no sync
    })
    expect(mockSync).toHaveBeenCalledTimes(1)

    await act(async () => {
      netHandler({ isConnected: true }) // back online — flush
    })
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(2))
  })

  it('does not re-sync on connectivity events without an offline→online transition', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc' })
    renderHook(() => useSync())
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))

    await act(async () => {
      netHandler({ isConnected: true }) // still connected — no extra sync
    })
    expect(mockSync).toHaveBeenCalledTimes(1)
  })

  it('runs a debounced sync when a local change is enqueued (pendingSignal bump)', async () => {
    jest.useFakeTimers()
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc' })
    renderHook(() => useSync())
    await act(async () => {
      await Promise.resolve() // let the mount sync settle
    })
    mockSync.mockClear()

    act(() => useSyncStore.getState().notifyLocalChange())
    expect(mockSync).not.toHaveBeenCalled() // debounced, not immediate

    act(() => jest.advanceTimersByTime(2000))
    expect(mockSync).toHaveBeenCalledTimes(1)
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
