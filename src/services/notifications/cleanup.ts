import * as Notifications from 'expo-notifications'

import { type Result, ok, err } from '@/types/result'

/** Best-effort, idempotent account-boundary cleanup. Every native operation is
 * attempted so one platform failure cannot leave other notification state behind. */
export async function cleanupNotifications(): Promise<Result<void>> {
  let firstError: unknown = null
  try { await Notifications.cancelAllScheduledNotificationsAsync() } catch (e) { firstError ??= e }
  try { await Notifications.dismissAllNotificationsAsync() } catch (e) { firstError ??= e }
  try { await Notifications.clearLastNotificationResponseAsync() } catch (e) { firstError ??= e }
  return firstError == null
    ? ok(undefined)
    : err('NOTIF_CLEANUP_FAILED', 'Notification cleanup failed', firstError)
}