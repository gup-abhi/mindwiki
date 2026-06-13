import { renderHook, act, waitFor } from '@testing-library/react-native'

import { usePursuitCheckin } from '@/hooks/usePursuitCheckin'
import { prepareCheckin } from '@/services/pursuits/checkin'
import { updatePursuit, type Pursuit } from '@/services/storage/pursuits'
import { ok } from '@/types/result'

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))
jest.mock('@/services/pursuits/checkin', () => ({ prepareCheckin: jest.fn() }))
jest.mock('@/services/storage/pursuits', () => ({ updatePursuit: jest.fn() }))

const mockPrepare = prepareCheckin as jest.Mock
const mockUpdate = updatePursuit as jest.Mock

const pursuit = (over: Partial<Pursuit> = {}): Pursuit => ({
  id: 'p1',
  title: 'Marathon training',
  details: '',
  status: 'active',
  checkin_question: 'How is the training going?',
  wiki_page_id: null,
  created_at: 0,
  updated_at: 0,
  last_mentioned_at: 0,
  last_checkin_at: null,
  ...over,
})

describe('usePursuitCheckin', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockPrepare.mockReset()
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue(ok(pursuit()))
  })

  it('exposes the due pursuit resolved on focus', async () => {
    mockPrepare.mockResolvedValue(pursuit())
    const { result } = renderHook(() => usePursuitCheckin())
    await waitFor(() => expect(result.current.checkin?.id).toBe('p1'))
  })

  it('is empty when nothing is due', async () => {
    mockPrepare.mockResolvedValue(null)
    const { result } = renderHook(() => usePursuitCheckin())
    await waitFor(() => expect(mockPrepare).toHaveBeenCalled())
    expect(result.current.checkin).toBeNull()
  })

  it('open() stamps the check-in and routes into Reflect with the question', async () => {
    mockPrepare.mockResolvedValue(pursuit())
    const { result } = renderHook(() => usePursuitCheckin())
    await waitFor(() => expect(result.current.checkin?.id).toBe('p1'))

    act(() => result.current.open())

    expect(mockUpdate).toHaveBeenCalledWith('p1', expect.objectContaining({ last_checkin_at: expect.any(Number) }))
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/query',
      params: { q: 'How is the training going?' },
    })
    expect(result.current.checkin).toBeNull() // card clears
  })

  it('dismiss() stamps the check-in without navigating', async () => {
    mockPrepare.mockResolvedValue(pursuit())
    const { result } = renderHook(() => usePursuitCheckin())
    await waitFor(() => expect(result.current.checkin?.id).toBe('p1'))

    act(() => result.current.dismiss())

    expect(mockUpdate).toHaveBeenCalledWith('p1', expect.objectContaining({ last_checkin_at: expect.any(Number) }))
    expect(mockPush).not.toHaveBeenCalled()
    expect(result.current.checkin).toBeNull()
  })
})
