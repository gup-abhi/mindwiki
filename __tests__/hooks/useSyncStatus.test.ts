import { renderHook, act, waitFor } from '@testing-library/react-native'

import { useSyncStatus } from '@/hooks/useSyncStatus'
import { sync } from '@/services/sync/engine'
import { getSetting } from '@/services/storage/settings'
import { pendingUploads } from '@/services/storage/sync-queue'

jest.mock('@/services/sync/engine', () => ({ sync: jest.fn() }))
jest.mock('@/services/storage/settings', () => ({ getSetting: jest.fn() }))
jest.mock('@/services/storage/sync-queue', () => ({ pendingUploads: jest.fn() }))

const mockSync = sync as jest.Mock
const mockGetSetting = getSetting as jest.Mock
const mockPending = pendingUploads as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockSync.mockResolvedValue({ success: true, data: { pushed: 0, pulled: 0 } })
  mockGetSetting.mockResolvedValue({ success: true, data: '1700000000000' })
  mockPending.mockResolvedValue({ success: true, data: [{ id: 'a' }, { id: 'b' }] })
})

describe('useSyncStatus', () => {
  it('reads last pull + pending count on mount', async () => {
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.pending).toBe(2))
    expect(result.current.lastPull).toBe(1700000000000)
  })

  it('reports Never when no pull has happened', async () => {
    mockGetSetting.mockResolvedValue({ success: true, data: null })
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    expect(result.current.lastPull).toBeNull()
  })

  it('syncNow runs a sync then refreshes', async () => {
    const { result } = renderHook(() => useSyncStatus())
    await waitFor(() => expect(result.current.pending).toBe(2))

    mockPending.mockResolvedValue({ success: true, data: [] }) // queue drained after sync
    await act(async () => {
      await result.current.syncNow()
    })

    expect(mockSync).toHaveBeenCalledTimes(1)
    expect(result.current.pending).toBe(0)
  })

  it('reports "already synced" when nothing changed', async () => {
    mockSync.mockResolvedValue({ success: true, data: { pushed: 0, pulled: 0 } })
    const { result } = renderHook(() => useSyncStatus())
    await act(async () => {
      await result.current.syncNow()
    })
    expect(result.current.message).toMatch(/already synced/i)
  })

  it('reports counts when changes were synced', async () => {
    mockSync.mockResolvedValue({ success: true, data: { pushed: 2, pulled: 1 } })
    const { result } = renderHook(() => useSyncStatus())
    await act(async () => {
      await result.current.syncNow()
    })
    expect(result.current.message).toMatch(/2 uploaded, 1 downloaded/)
  })

  it('reports a failure message', async () => {
    mockSync.mockResolvedValue({ success: false, error: { code: 'X', message: 'no' } })
    const { result } = renderHook(() => useSyncStatus())
    await act(async () => {
      await result.current.syncNow()
    })
    expect(result.current.message).toMatch(/failed/i)
  })
})
