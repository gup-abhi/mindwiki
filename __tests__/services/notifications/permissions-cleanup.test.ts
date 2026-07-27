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
})