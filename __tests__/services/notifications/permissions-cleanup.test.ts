import * as Notifications from 'expo-notifications'

import { cleanupNotifications } from '@/services/notifications/cleanup'
import { notificationPermissionState } from '@/services/notifications/permissions'

const getPermissions = Notifications.getPermissionsAsync as jest.Mock
const cancelAll = Notifications.cancelAllScheduledNotificationsAsync as jest.Mock
const dismissAll = Notifications.dismissAllNotificationsAsync as jest.Mock
const clearLast = Notifications.clearLastNotificationResponseAsync as jest.Mock

describe('notification permissions and cleanup', () => {
  beforeEach(() => jest.clearAllMocks())

  it('recognizes provisional iOS authorization', async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      ios: { status: Notifications.IosAuthorizationStatus.PROVISIONAL },
    })
    await expect(notificationPermissionState()).resolves.toBe('provisional')
  })

  it('maps Android denied while still askable to denied', async () => {
    getPermissions.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'denied' })
    await expect(notificationPermissionState()).resolves.toBe('denied')
  })

  it('maps denied with no further prompt to blocked', async () => {
    getPermissions.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' })
    await expect(notificationPermissionState()).resolves.toBe('blocked')
  })

  it('keeps undetermined permission distinct', async () => {
    getPermissions.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'undetermined' })
    await expect(notificationPermissionState()).resolves.toBe('not-determined')
  })

  it('clears scheduled, delivered, and cached notifications', async () => {
    await expect(cleanupNotifications()).resolves.toEqual({ success: true, data: undefined })
    expect(cancelAll).toHaveBeenCalledTimes(1)
    expect(dismissAll).toHaveBeenCalledTimes(1)
    expect(clearLast).toHaveBeenCalledTimes(1)
  })

  it('returns error but attempts every cleanup operation', async () => {
    cancelAll.mockRejectedValueOnce(new Error('native failure'))
    const result = await cleanupNotifications()
    expect(result.success).toBe(false)
    expect(dismissAll).toHaveBeenCalledTimes(1)
    expect(clearLast).toHaveBeenCalledTimes(1)
  })

  it('bounds a hung native operation without delaying the other cleanup calls', async () => {
    jest.useFakeTimers()
    cancelAll.mockImplementationOnce(() => new Promise(() => undefined))
    const result = cleanupNotifications()
    await jest.advanceTimersByTimeAsync(1500)
    await expect(result).resolves.toEqual({ success: true, data: undefined })
    expect(dismissAll).toHaveBeenCalledTimes(1)
    expect(clearLast).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })
})