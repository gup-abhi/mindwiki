import { renderHook, act, waitFor } from '@testing-library/react-native'

import { useChallenge } from '@/hooks/useChallenge'
import {
  createChallenge,
  deleteChallenge,
  getActiveChallenge,
  listChallenges,
  type Challenge,
} from '@/services/storage/challenges'
import { recordCheckin } from '@/services/challenges/checkin'
import {
  cancelChallengeReminders,
  ensurePermission,
  scheduleChallengeReminders,
} from '@/services/notifications/scheduler'
import { reconcileNotifications } from '@/services/notifications/orchestrator'
import { err, ok } from '@/types/result'

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(() => cb(), [])
  },
}))
jest.mock('@/services/storage/challenges', () => ({
  createChallenge: jest.fn(),
  deleteChallenge: jest.fn(),
  getActiveChallenge: jest.fn(),
  listChallenges: jest.fn(),
}))
jest.mock('@/services/challenges/checkin', () => ({
  recordCheckin: jest.fn(),
  effectiveStreak: (c: Challenge) => c.current_streak,
  isDoneToday: () => false,
}))
jest.mock('@/services/notifications/scheduler', () => ({
  ensurePermission: jest.fn(),
  scheduleChallengeReminders: jest.fn(),
  cancelChallengeReminders: jest.fn(),
}))
jest.mock('@/services/notifications/orchestrator', () => ({
  reconcileNotifications: jest.fn().mockResolvedValue({ success: true, data: { scheduled: 0, cancelled: 0, suppressed: 0, permission: 'not-determined' } }),
}))

const mockGetActive = getActiveChallenge as jest.Mock
const mockList = listChallenges as jest.Mock
const mockCreate = createChallenge as jest.Mock
const mockDelete = deleteChallenge as jest.Mock
const mockRecord = recordCheckin as jest.Mock
const mockSchedule = scheduleChallengeReminders as jest.Mock
const mockCancel = cancelChallengeReminders as jest.Mock
const mockPerms = ensurePermission as jest.Mock
const mockReconcile = reconcileNotifications as jest.Mock

const challenge = (over: Partial<Challenge> = {}): Challenge => ({
  id: 'c1',
  title: 'Work out',
  details: '',
  target_days: 30,
  current_streak: 0,
  last_checkin_date: '',
  status: 'active',
  affirmation: '',
  created_at: 0,
  updated_at: 0,
  completed_at: null,
  ...over,
})

describe('useChallenge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetActive.mockResolvedValue(ok(null))
    mockList.mockResolvedValue(ok([]))
    mockCreate.mockResolvedValue(ok(challenge()))
    mockDelete.mockResolvedValue(ok(undefined))
    mockSchedule.mockResolvedValue(ok(0))
    mockCancel.mockResolvedValue(ok(undefined))
    mockPerms.mockResolvedValue(ok(true))
  })

  it('loads the active challenge on focus', async () => {
    mockGetActive.mockResolvedValue(ok(challenge({ current_streak: 3 })))
    const { result } = renderHook(() => useChallenge())
    await waitFor(() => expect(result.current.challenge?.id).toBe('c1'))
    expect(result.current.streak).toBe(3)
  })

  it('loads completed challenges as rewards on focus', async () => {
    mockList.mockResolvedValue(
      ok([
        challenge({ id: 'done1', status: 'completed', affirmation: 'I show up.' }),
        challenge({ id: 'active1', status: 'active' }),
      ])
    )
    const { result } = renderHook(() => useChallenge())
    await waitFor(() => expect(result.current.rewards).toHaveLength(1))
    expect(result.current.rewards[0].id).toBe('done1')
  })

  it('create requests central notification reconciliation without prompting', async () => {
    const { result } = renderHook(() => useChallenge())
    let created: Challenge | null = null
    await act(async () => {
      created = await result.current.create({ title: 'Read' })
    })
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Read' })
    expect(mockPerms).not.toHaveBeenCalled()
    expect(mockSchedule).not.toHaveBeenCalled()
    expect(mockReconcile).toHaveBeenCalledWith('challenge-changed')
    expect(created).toEqual(expect.objectContaining({ id: 'c1' }))
  })

  it('checkIn on an active challenge reconciles notification state', async () => {
    mockGetActive.mockResolvedValue(ok(challenge({ current_streak: 2 })))
    mockRecord.mockResolvedValue(
      ok({
        challenge: challenge({ current_streak: 3, status: 'active' }),
        decision: { outcome: 'continued', streak: 3, justCompleted: false },
      })
    )
    const { result } = renderHook(() => useChallenge())
    await waitFor(() => expect(result.current.challenge?.id).toBe('c1'))

    await act(async () => {
      await result.current.checkIn()
    })
    expect(mockRecord).toHaveBeenCalledWith('c1', expect.any(Number))
    expect(mockSchedule).not.toHaveBeenCalled()
    expect(mockReconcile).toHaveBeenCalledWith('challenge-changed')
  })

  it('checkIn that completes reconciles reminders and clears the active challenge', async () => {
    mockGetActive.mockResolvedValue(ok(challenge({ current_streak: 29 })))
    mockRecord.mockResolvedValue(
      ok({
        challenge: challenge({ current_streak: 30, status: 'completed' }),
        decision: { outcome: 'continued', streak: 30, justCompleted: true },
      })
    )
    const { result } = renderHook(() => useChallenge())
    await waitFor(() => expect(result.current.challenge?.id).toBe('c1'))

    await act(async () => {
      await result.current.checkIn()
    })
    expect(mockCancel).not.toHaveBeenCalled()
    expect(mockReconcile).toHaveBeenCalledWith('challenge-changed')
    expect(result.current.challenge).toBeNull()
    // the freshly completed challenge becomes an earned reward
    expect(result.current.rewards).toHaveLength(1)
    expect(result.current.rewards[0].status).toBe('completed')
  })

  it('remove reconciles reminders only after successful deletion', async () => {
    mockGetActive.mockResolvedValue(ok(challenge()))
    const calls: string[] = []
    mockDelete.mockImplementation(async () => { calls.push('delete'); return ok(undefined) })
    mockReconcile.mockImplementation(async () => {
      calls.push('reconcile')
      return ok({ scheduled: 0, cancelled: 0, suppressed: 0, permission: 'not-determined' })
    })
    const { result } = renderHook(() => useChallenge())
    await waitFor(() => expect(result.current.challenge?.id).toBe('c1'))

    await act(async () => {
      await result.current.remove()
    })
    expect(mockCancel).not.toHaveBeenCalled()
    expect(calls).toEqual(['delete', 'reconcile'])
    expect(mockDelete).toHaveBeenCalledWith('c1')
    expect(result.current.challenge).toBeNull()
  })

  it('keeps challenge state and skips reconcile when deletion fails', async () => {
    mockGetActive.mockResolvedValue(ok(challenge()))
    mockDelete.mockResolvedValue(err('DELETE_FAILED', 'Failed to delete challenge'))
    const { result } = renderHook(() => useChallenge())
    await waitFor(() => expect(result.current.challenge?.id).toBe('c1'))

    await act(async () => {
      await result.current.remove()
    })

    expect(mockReconcile).not.toHaveBeenCalled()
    expect(result.current.challenge?.id).toBe('c1')
  })
})
