import * as Notifications from 'expo-notifications'

import { type Result, ok, err } from '@/types/result'
import { type NotificationPermissionState } from './types'

export async function notificationPermissionState(): Promise<NotificationPermissionState> {
  try {
    const status = await Notifications.getPermissionsAsync()
    if (status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'provisional'
    if (status.granted) return 'granted'
    if (status.canAskAgain === false) return 'blocked'
    if (status.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return 'denied'
    return 'not-determined'
  } catch {
    return 'denied'
  }
}

function stateFromResponse(status: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>): NotificationPermissionState {
  if (status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'provisional'
  if (status.granted) return 'granted'
  if (status.canAskAgain === false) return 'blocked'
  if (status.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return 'denied'
  return 'not-determined'
}

export async function requestNotificationPermission(): Promise<Result<NotificationPermissionState>> {
  try {
    const current = await Notifications.getPermissionsAsync()
    if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return ok(stateFromResponse(current))
    }
    if (current.canAskAgain === false) return ok(stateFromResponse(current))
    const requested = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } })
    return ok(stateFromResponse(requested))
  } catch (e) {
    return err('NOTIF_PERMISSION_FAILED', 'Notification permission request failed', e)
  }
}