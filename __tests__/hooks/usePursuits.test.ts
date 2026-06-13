import { renderHook, act, waitFor } from '@testing-library/react-native'

import { usePursuits } from '@/hooks/usePursuits'
import { deletePursuit, listPursuits, updatePursuit, type Pursuit } from '@/services/storage/pursuits'
import { ok } from '@/types/result'

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))
jest.mock('@/services/storage/pursuits', () => ({
  listPursuits: jest.fn(),
  updatePursuit: jest.fn(),
  deletePursuit: jest.fn(),
}))

const mockList = listPursuits as jest.Mock
const mockUpdate = updatePursuit as jest.Mock
const mockDelete = deletePursuit as jest.Mock

const pursuit = (over: Partial<Pursuit> = {}): Pursuit => ({
  id: 'p1',
  title: 'Marathon training',
  details: '',
  status: 'active',
  checkin_question: '',
  wiki_page_id: null,
  created_at: 0,
  updated_at: 0,
  last_mentioned_at: 0,
  last_checkin_at: null,
  ...over,
})

describe('usePursuits', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    mockList.mockResolvedValue(ok([pursuit()]))
    mockUpdate.mockResolvedValue(ok(pursuit()))
    mockDelete.mockResolvedValue(ok(undefined))
  })

  it('loads pursuits on focus', async () => {
    const { result } = renderHook(() => usePursuits())
    await waitFor(() => expect(result.current.pursuits).toHaveLength(1))
  })

  it('setStatus("done") just sets the status', async () => {
    const { result } = renderHook(() => usePursuits())
    await waitFor(() => expect(result.current.pursuits).toHaveLength(1))

    await act(async () => result.current.setStatus('p1', 'done'))
    expect(mockUpdate).toHaveBeenCalledWith('p1', { status: 'done' })
  })

  it('setStatus("active") restarts the cadence (resets mention + clears question)', async () => {
    const { result } = renderHook(() => usePursuits())
    await waitFor(() => expect(result.current.pursuits).toHaveLength(1))

    await act(async () => result.current.setStatus('p1', 'active'))
    const [id, patch] = mockUpdate.mock.calls[0]
    expect(id).toBe('p1')
    expect(patch.status).toBe('active')
    expect(patch.checkin_question).toBe('')
    expect(typeof patch.last_mentioned_at).toBe('number')
  })

  it('remove deletes and refreshes', async () => {
    const { result } = renderHook(() => usePursuits())
    await waitFor(() => expect(result.current.pursuits).toHaveLength(1))

    await act(async () => result.current.remove('p1'))
    expect(mockDelete).toHaveBeenCalledWith('p1')
    expect(mockList).toHaveBeenCalledTimes(2) // initial focus + after remove
  })
})
