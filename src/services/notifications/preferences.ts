import { z } from 'zod'

import { type Result, ok, err } from '@/types/result'
import { getSetting, setSetting } from '@/services/storage/settings'
import { DEFAULT_NOTIFICATION_PREFERENCES } from './policy'
import { type NotificationPreferences, ROUTINE_HOURS, ROUTINE_WEEKDAYS, RETRY_DELAYS } from './types'

const KEY = 'notification_preferences_v2'
const LEGACY_KEY = 'notification_preferences_v1'

const Schema = z.object({
  enabled: z.boolean(),
  routineWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  routineHour: z.number().int().refine((value) => ROUTINE_HOURS.includes(value)).optional(),
  retryDelayMinutes: z.union([z.literal(RETRY_DELAYS[0]), z.literal(RETRY_DELAYS[1]), z.literal(RETRY_DELAYS[2])]).optional(),
  pausedUntil: z.number().nullable(),
  firstPlanSavedAt: z.number().nullable().optional(),
  setupDismissed: z.boolean().optional(),
  challenge: z.boolean(),
  insights: z.boolean(),
  weeklyReview: z.boolean().optional(),
  weeklyReviewWeekday: z.number().int().min(0).max(6).optional(),
  weeklyReviewHour: z.number().int().refine((value) => ROUTINE_HOURS.includes(value)).optional(),
  journal: z.boolean(),
  reengagement: z.boolean(),
  momentum: z.boolean(),
  patterns: z.boolean(),
  quietStartHour: z.number().int().min(0).max(23),
  quietEndHour: z.number().int().min(0).max(23),
  reminderStartHour: z.number().int().min(0).max(23),
  reminderEndHour: z.number().int().min(0).max(23),
})

export async function getNotificationPreferences(): Promise<Result<NotificationPreferences>> {
  try {
    const current = await getSetting(KEY)
    if (current.success && current.data) {
      try {
        const parsed = Schema.safeParse(JSON.parse(current.data))
        if (parsed.success) return ok({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...parsed.data, routineWeekdays: [...new Set(parsed.data.routineWeekdays ?? DEFAULT_NOTIFICATION_PREFERENCES.routineWeekdays)].sort() })
      } catch {
        // Fall through to disabled defaults.
      }
    }
    const legacy = await getSetting(LEGACY_KEY)
    if (legacy.success && legacy.data) {
      const migrated = { ...DEFAULT_NOTIFICATION_PREFERENCES }
      await setSetting(KEY, JSON.stringify(migrated))
      return ok(migrated)
    }
    return ok({ ...DEFAULT_NOTIFICATION_PREFERENCES, routineWeekdays: [...(DEFAULT_NOTIFICATION_PREFERENCES.routineWeekdays ?? [])] })
  } catch {
    return ok({ ...DEFAULT_NOTIFICATION_PREFERENCES, routineWeekdays: [...(DEFAULT_NOTIFICATION_PREFERENCES.routineWeekdays ?? [])] })
  }
}

export async function setNotificationPreferences(preferences: NotificationPreferences): Promise<Result<void>> {
  const parsed = Schema.safeParse(preferences)
  if (!parsed.success) return err('NOTIF_PREFERENCES_INVALID', 'Invalid notification preferences')
  try {
    return await setSetting(KEY, JSON.stringify({ ...parsed.data, routineWeekdays: [...new Set(parsed.data.routineWeekdays ?? [])].sort() }))
  } catch (e) {
    return err('NOTIF_PREFERENCES_SET_FAILED', 'Notification settings unavailable', e)
  }
}
