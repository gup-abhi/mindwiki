import { renderHook, waitFor } from '@testing-library/react-native'

import { useEntries } from '@/hooks/useEntries'
import { listEntries } from '@/services/storage/entries'
import { ok } from '@/types/result'

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))
jest.mock('@/services/storage/entries', () => ({ listEntries: jest.fn() }))

const mockList = listEntries as jest.Mock

describe('useEntries', () => {
  beforeEach(() => mockList.mockReset())

  it('loads entries on focus and exposes the count', async () => {
    mockList.mockResolvedValue(ok([{ id: 'a' }, { id: 'b' }]))
    const { result } = renderHook(() => useEntries())
    await waitFor(() => expect(result.current.count).toBe(2))
    expect(result.current.loading).toBe(false)
  })

  it('count stays 0 when there are no entries', async () => {
    mockList.mockResolvedValue(ok([]))
    const { result } = renderHook(() => useEntries())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(0)
  })
})
