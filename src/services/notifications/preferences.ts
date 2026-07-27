import { z } from 'zod'

import { type Result, ok, err } from '@/types/result'
import { getSetting, setSetting } from '@/services/storage/settings'
import { DEFAULT_NOTIFICATION_PREFERENCES } from './policy'
import { type NotificationPreferences } from './types'

const KEY = 'notification_preferences_v1'
const Schema = z.object({
  enabled: z.boolean().default(false),
  journal: z.boolean().default(true),
  challenge: z.boolean().default(true),
  reengagement: z.boolean().default(true),
  insights: z.boolean().default(true),
  momentum: z.boolean().default(false),
  patterns: z.boolean().default(false),
  quietStartHour: z.number().int().min(0).max(23).default(21),
  quietEndHour: z.number().int().min(0).max(23).default(9),
  reminderStartHour: z.number().int().min(0).max(23).default(17),
  reminderEndHour: z.number().int().min(0).max(23).default(21),
  pausedUntil: z.number().nullable().default(null),
})

export async function getNotificationPreferences(): Promise<Result<NotificationPreferences>> {
  let value
  try { value = await getSetting(KEY) } catch { return ok({ ...DEFAULT_NOTIFICATION_PREFERENCES }) }
  if (!value.success) return value
  if (!value.data) return ok({ ...DEFAULT_NOTIFICATION_PREFERENCES })
  try {
    const parsed = Schema.safeParse(JSON.parse(value.data))
    return parsed.success ? ok(parsed.data) : ok({ ...DEFAULT_NOTIFICATION_PREFERENCES })
  } catch { return ok({ ...DEFAULT_NOTIFICATION_PREFERENCES }) }
}

export async function setNotificationPreferences(preferences: NotificationPreferences): Promise<Result<void>> {
  const parsed = Schema.safeParse(preferences)
  if (!parsed.success) return err('NOTIF_PREFERENCES_INVALID', 'Invalid notification preferences')
  try { return await setSetting(KEY, JSON.stringify(parsed.data)) }
  catch (e) { return err('NOTIF_PREFERENCES_SET_FAILED', 'Notification settings unavailable', e) }
}