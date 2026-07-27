import * as Notifications from 'expo-notifications'

import { type Result, ok, err } from '@/types/result'

// Hard cap so a hung native notification API cannot block the local wipe.
// The wipe MUST complete: a failed/hung cleanup just leaves native state behind,
// recoverable on the next launch (unauthenticated gate also calls cleanup).
const CLEANUP_TIMEOUT_MS = 1500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      resolve(null)
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (cause: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(cause)
      }
    )
  })
}

/** Best-effort, idempotent account-boundary cleanup. Every native operation is
 * attempted so one platform failure cannot leave other notification state behind.
 * Bounded by CLEANUP_TIMEOUT_MS so a hung native module never delays the local
 * wipe. */
export async function cleanupNotifications(): Promise<Result<void>> {
  let firstError: unknown = null
  const safe = async (op: () => Promise<unknown>): Promise<void> => {
    try { await withTimeout(op(), CLEANUP_TIMEOUT_MS) } catch (e) { firstError ??= e }
  }
  await Promise.all([
    safe(() => Notifications.cancelAllScheduledNotificationsAsync()),
    safe(() => Notifications.dismissAllNotificationsAsync()),
    safe(() => Notifications.clearLastNotificationResponseAsync()),
  ])
  return firstError == null
    ? ok(undefined)
    : err('NOTIF_CLEANUP_FAILED', 'Notification cleanup failed', firstError)
}