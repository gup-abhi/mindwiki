import * as Notifications from 'expo-notifications'

import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { getSetting, setSetting } from '@/services/storage/settings'
import { type Result, ok, err } from '@/types/result'

import { reminderCopy } from './copy'
import {
  type HourHistogram,
  emptyHistogram,
  optimalHour,
  recordActivity as recordIntoHistogram,
} from './timing'

const HISTOGRAM_KEY = 'notif_hour_histogram'
const PERMISSION_ASKED_KEY = 'notif_permission_asked'
const DAILY_ID = 'mindwiki-daily-reminder'
const WEEKLY_DIGEST_ID = 'mindwiki-weekly-digest'
const DAY_MS = 86_400_000

/** Show reminders even when the app is foregrounded; no sound/badge. */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })
}

/** Request notification permission (call after the first entry, not on launch). */
export async function ensurePermission(): Promise<Result<boolean>> {
  try {
    const current = await Notifications.getPermissionsAsync()
    if (current.granted) return ok(true)
    if (current.canAskAgain === false) return ok(false)
    const req = await Notifications.requestPermissionsAsync()
    return ok(req.granted)
  } catch (e) {
    return err('NOTIF_PERMISSION_FAILED', 'Notification permission request failed', e)
  }
}

async function loadHistogram(db: SqliteDatabase): Promise<HourHistogram> {
  const res = await getSetting(HISTOGRAM_KEY, db)
  if (res.success && res.data) {
    try {
      const parsed: unknown = JSON.parse(res.data)
      if (Array.isArray(parsed) && parsed.length === 24) return parsed as HourHistogram
    } catch {
      // fall through to a fresh histogram
    }
  }
  return emptyHistogram()
}

/** Record an activity (entry/open) into the persisted hour histogram. */
export async function recordActivity(
  ts: number,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    const next = recordIntoHistogram(await loadHistogram(db), ts)
    return await setSetting(HISTOGRAM_KEY, JSON.stringify(next), db)
  } catch (e) {
    return err('NOTIF_RECORD_FAILED', 'Failed to record activity', e)
  }
}

/**
 * Reschedule the single daily reminder at the histogram's optimal hour, with
 * the day's rotating copy. Replaces any previously scheduled reminder.
 * Returns the chosen hour.
 */
export async function rescheduleDailyReminder(
  now: number,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    const hour = optimalHour(await loadHistogram(db))
    const dayIndex = Math.floor(now / DAY_MS)
    await Notifications.cancelScheduledNotificationAsync(DAILY_ID).catch(() => {})
    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_ID,
      content: { title: 'MindWiki', body: reminderCopy(dayIndex) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute: 0 },
    })
    return ok(hour)
  } catch (e) {
    return err('NOTIF_SCHEDULE_FAILED', 'Failed to schedule reminder', e)
  }
}

/** Schedule the Sunday-morning (9am) weekly digest reminder, replacing any prior. */
export async function scheduleWeeklyDigest(): Promise<Result<void>> {
  try {
    await Notifications.cancelScheduledNotificationAsync(WEEKLY_DIGEST_ID).catch(() => {})
    await Notifications.scheduleNotificationAsync({
      identifier: WEEKLY_DIGEST_ID,
      content: { title: 'Your weekly digest', body: 'Your week in review is ready — take a look.' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 1, // 1 = Sunday
        hour: 9,
        minute: 0,
      },
    })
    return ok(undefined)
  } catch (e) {
    return err('DIGEST_SCHEDULE_FAILED', 'Failed to schedule weekly digest', e)
  }
}

/**
 * Run after an entry is saved: ask for notification permission once (after the
 * first entry, never on launch), record the activity, and reschedule the daily
 * reminder + the weekly digest. Best-effort — callers fire-and-forget; never
 * blocks the entry.
 */
export async function onEntrySaved(
  now: number,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    const asked = await getSetting(PERMISSION_ASKED_KEY, db)
    if (!(asked.success && asked.data === '1')) {
      await ensurePermission()
      await setSetting(PERMISSION_ASKED_KEY, '1', db)
    }
    await recordActivity(now, db)
    await rescheduleDailyReminder(now, db)
    await scheduleWeeklyDigest()
    return ok(undefined)
  } catch (e) {
    return err('NOTIF_ON_ENTRY_FAILED', 'Failed to update habit state', e)
  }
}
