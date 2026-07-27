import * as Notifications from 'expo-notifications'

import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { getSetting, setSetting } from '@/services/storage/settings'
import { type Result, ok, err } from '@/types/result'

import { type Challenge } from '@/services/storage/challenges'

import { challengeCopy, reminderCopy } from './copy'
import { scheduleFirstInsightCandidate } from './orchestrator'
import { requestNotificationPermission } from './permissions'
import {
  type HourHistogram,
  emptyHistogram,
  reminderHour,
  recordActivity as recordIntoHistogram,
} from './timing'

const HISTOGRAM_KEY = 'notif_hour_histogram'

const DAILY_ID = 'mindwiki-daily-reminder'
const WEEKLY_DIGEST_ID = 'mindwiki-weekly-digest'
const CHALLENGE_ID_PREFIX = 'mindwiki-challenge'
const DAY_MS = 86_400_000
// How many days ahead to arm evening reminders. Re-armed on each entry save, so
// this is the buffer that keeps nudges coming if the user lapses for a while.
const REMINDER_DAYS = 7
// Challenge nudges fire in the morning ("go do your thing today"), distinct from
// the evening journaling reminder. A buffer of one-shot reminders armed ahead and
// re-armed on each check-in, so nudges keep coming if the user lapses a little.
const CHALLENGE_REMINDER_HOUR = 9
const CHALLENGE_REMINDER_DAYS = 14

/** Show reminders even when the app is foregrounded; no sound/badge. */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // Foreground notifications do not interrupt active journaling. The
      // authenticated app can surface an in-app explanation later.
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })
}

/** Request notification permission (call after the first entry, not on launch). */
export async function ensurePermission(): Promise<Result<boolean>> {
  const result = await requestNotificationPermission()
  return result.success ? ok(result.data === 'granted' || result.data === 'provisional') : result
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
 * (Re)schedule evening journaling reminders as one-shot notifications for the
 * next REMINDER_DAYS days, at the user's evening hour (5–9pm window, default
 * 8pm). The save day is skipped when `journaledToday` — and so is today if its
 * evening hour has already passed — so a reminder only fires on an evening the
 * user hasn't journaled yet. Re-armed on each entry save, which also rolls the
 * window forward. Returns the chosen hour.
 */
export async function scheduleDailyReminders(
  now: number,
  journaledToday: boolean,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    const hour = reminderHour(await loadHistogram(db))

    // Clear the legacy single repeating reminder + any previously armed batch.
    await Notifications.cancelScheduledNotificationAsync(DAILY_ID).catch(() => {})
    for (let i = 0; i < REMINDER_DAYS; i++) {
      await Notifications.cancelScheduledNotificationAsync(`${DAILY_ID}-${i}`).catch(() => {})
    }

    let slot = 0
    for (let i = 0; i < REMINDER_DAYS; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() + i)
      date.setHours(hour, 0, 0, 0)
      // Don't remind on a day already journaled, or for an evening already past.
      if (i === 0 && (journaledToday || date.getTime() <= now)) continue
      await Notifications.scheduleNotificationAsync({
        identifier: `${DAILY_ID}-${slot}`,
        content: { title: 'MindWiki', body: reminderCopy(Math.floor(date.getTime() / DAY_MS)) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      })
      slot++
    }
    return ok(hour)
  } catch (e) {
    return err('NOTIF_SCHEDULE_FAILED', 'Failed to schedule reminders', e)
  }
}

function challengeNotifId(challengeId: string, slot: number): string {
  return `${CHALLENGE_ID_PREFIX}-${challengeId}-${slot}`
}

/** Cancel a challenge's armed morning nudges (e.g. on completion or deletion). */
export async function cancelChallengeReminders(challengeId: string): Promise<Result<void>> {
  try {
    for (let i = 0; i < CHALLENGE_REMINDER_DAYS; i++) {
      await Notifications.cancelScheduledNotificationAsync(challengeNotifId(challengeId, i)).catch(
        () => {}
      )
    }
    return ok(undefined)
  } catch (e) {
    return err('CHALLENGE_NOTIF_CANCEL_FAILED', 'Failed to cancel challenge reminders', e)
  }
}

/**
 * (Re)arm a challenge's morning nudges: one-shot 9am reminders for the next
 * CHALLENGE_REMINDER_DAYS days, re-armed on each check-in (which rolls the window
 * forward). Today is skipped when already done — or when 9am has passed — so a
 * nudge only fires on a morning the user hasn't checked in yet. Cancels and
 * schedules nothing for a non-active challenge. Copy is generic (no title/streak
 * — it shows on the lock screen). Returns the number of reminders armed.
 */
export async function scheduleChallengeReminders(
  challenge: Pick<Challenge, 'id' | 'status'>,
  now: number,
  doneToday: boolean
): Promise<Result<number>> {
  try {
    await cancelChallengeReminders(challenge.id)
    if (challenge.status !== 'active') return ok(0)

    let slot = 0
    for (let i = 0; i < CHALLENGE_REMINDER_DAYS; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() + i)
      date.setHours(CHALLENGE_REMINDER_HOUR, 0, 0, 0)
      if (i === 0 && (doneToday || date.getTime() <= now)) continue
      await Notifications.scheduleNotificationAsync({
        identifier: challengeNotifId(challenge.id, slot),
        content: { title: 'MindWiki', body: challengeCopy(Math.floor(date.getTime() / DAY_MS)) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      })
      slot++
    }
    return ok(slot)
  } catch (e) {
    return err('CHALLENGE_NOTIF_SCHEDULE_FAILED', 'Failed to schedule challenge reminders', e)
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
 * Fire one immediate local notification announcing the user's first synthesized
 * insight page — the deferred aha moment, delivered once the deep model has
 * finished weaving the first-run entries. Route is resolved from encrypted
 * candidate metadata after an authenticated tap. Best-effort, never throws.
 */
export async function sendFirstPageReadyNotification(page: {
  id: string
  title: string
}): Promise<Result<void>> {
  // `title` remains in the API for compatibility with the onboarding marker,
  // but never enters native notification content. Route is encrypted locally in
  // the candidate table; OS receives only opaque candidateId + kind.
  return scheduleFirstInsightCandidate(page.id)
}

/**
 * Run after an entry is saved: record local activity. Permission and native
 * scheduling are owned by explicit Settings opt-in plus orchestrator.
 */
export async function onEntrySaved(
  now: number,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    // Permission is now explicit user action from Settings. Entry saves only
    // record local activity and reconcile existing opt-in preferences.
    await recordActivity(now, db)
    // Reconciliation owns native requests. Legacy batch exports remain for
    // compatibility, but save events no longer create unmanaged requests.
    return ok(undefined)
  } catch (e) {
    return err('NOTIF_ON_ENTRY_FAILED', 'Failed to update habit state', e)
  }
}
