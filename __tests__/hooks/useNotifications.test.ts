import { act, renderHook, waitFor } from '@testing-library/react-native'

import { useNotifications } from '@/hooks/useNotifications'
import { reconcileNotifications } from '@/services/notifications/orchestrator'
import { notificationPermissionState, requestNotificationPermission } from '@/services/notifications/permissions'
import { getNotificationPreferences, setNotificationPreferences } from '@/services/notifications/preferences'
import { recordReflectionPlanVersion } from '@/services/notifications/plan'
import { ok, err } from '@/types/result'

jest.mock('@/services/notifications/orchestrator', () => ({ reconcileNotifications: jest.fn() }))
jest.mock('@/services/notifications/permissions', () => ({
  notificationPermissionState: jest.fn(),
  requestNotificationPermission: jest.fn(),
}))
jest.mock('@/services/notifications/preferences', () => ({
  getNotificationPreferences: jest.fn(),
  setNotificationPreferences: jest.fn(),
}))
jest.mock('@/services/notifications/plan', () => ({ recordReflectionPlanVersion: jest.fn() }))

const mockReconcile = reconcileNotifications as jest.Mock
const mockPermissionState = notificationPermissionState as jest.Mock
const mockRequestPermission = requestNotificationPermission as jest.Mock
const mockGetPreferences = getNotificationPreferences as jest.Mock
const mockSetPreferences = setNotificationPreferences as jest.Mock
const mockRecordPlan = recordReflectionPlanVersion as jest.Mock

const preferences = {
  enabled: false,
  routineWeekdays: [1, 2, 3, 4, 5],
  routineHour: 20,
  retryDelayMinutes: 60 as const,
  pausedUntil: null,
  challenge: false,
  insights: false,
  weeklyReview: false,
  journal: true,
  reengagement: true,
  momentum: false,
  patterns: false,
  quietStartHour: 21,
  quietEndHour: 9,
  reminderStartHour: 17,
  reminderEndHour: 21,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPreferences.mockResolvedValue(ok(preferences))
  mockPermissionState.mockResolvedValue('not-determined')
  mockRequestPermission.mockResolvedValue(ok('granted'))
  mockSetPreferences.mockResolvedValue(ok(undefined))
  mockRecordPlan.mockResolvedValue(ok(undefined))
  mockReconcile.mockResolvedValue(ok({ scheduled: 2, cancelled: 0, suppressed: 0, permission: 'granted' }))
})

describe('useNotifications', () => {
  it('re-arms enabled reminders after permission is restored in system settings', async () => {
    mockGetPreferences.mockResolvedValue(ok({ ...preferences, enabled: true }))
    mockPermissionState.mockResolvedValue('granted')

    renderHook(() => useNotifications())

    await waitFor(() => expect(mockReconcile).toHaveBeenCalledWith('resume'))
  })

  it('requests permission before enabling and scheduling a routine', async () => {
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(mockGetPreferences).toHaveBeenCalled())

    await act(async () => {
      await result.current.enable()
    })

    expect(mockRequestPermission).toHaveBeenCalledTimes(1)
    expect(mockSetPreferences).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(mockRecordPlan).toHaveBeenCalled()
    expect(mockReconcile).toHaveBeenCalledWith('preferences')
  })

  it('does not enable reminders when notification permission is denied', async () => {
    mockRequestPermission.mockResolvedValue(ok('denied'))
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(mockGetPreferences).toHaveBeenCalled())

    let saved
    await act(async () => {
      saved = await result.current.enable()
    })

    expect(saved).toMatchObject({ success: false, error: { code: 'NOTIF_PERMISSION_REQUIRED' } })
    expect(result.current.permission).toBe('denied')
    expect(mockSetPreferences).not.toHaveBeenCalled()
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('saves a disabled dismissal without requesting notification permission', async () => {
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(mockGetPreferences).toHaveBeenCalled())

    await act(async () => {
      await result.current.savePlan({ setupDismissed: true, enabled: false })
    })

    expect(mockRequestPermission).not.toHaveBeenCalled()
    expect(mockSetPreferences).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, setupDismissed: true }))
  })

  it('returns reconciliation failures instead of reporting a successful save', async () => {
    mockReconcile.mockResolvedValue(err('NOTIF_SCHEDULE_FAILED', 'Could not schedule reminders on this device'))
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(mockGetPreferences).toHaveBeenCalled())

    let saved
    await act(async () => {
      saved = await result.current.savePlan({ enabled: true })
    })

    expect(saved).toMatchObject({ success: false, error: { code: 'NOTIF_SCHEDULE_FAILED' } })
  })
})
