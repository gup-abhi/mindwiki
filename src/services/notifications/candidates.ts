import { randomUUID } from 'expo-crypto'

import { listEntries } from '@/services/storage/entries'
import { getActiveChallenge } from '@/services/storage/challenges'
import { generateDigest } from '@/services/digest/generator'
import { detectMomentum, detectWeeklyRhythm } from '@/services/insights/mood-stats'
import { type NotificationCandidate } from './types'
import { getNotificationPreferences } from './preferences'
import { adaptiveReminderTiming, DEFAULT_SEND_HOUR } from './timing'

const DAY_MS = 86_400_000

function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

function localDate(ts: number): string {
  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function atLocalDay(day: number, hour: number): number {
  const d = new Date(day * DAY_MS)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0).getTime()
}

function candidate(kind: NotificationCandidate['kind'], dedupeKey: string, route: string, eligibleAt: number, expiresAt: number, priority: number): NotificationCandidate {
  return { id: randomUUID(), kind, dedupeKey, targetRoute: route, eligibleAt, expiresAt, priority }
}

export async function hasJournalEntryToday(now: number): Promise<boolean> {
  const entries = await listEntries(1)
  return entries.success && entries.data[0] != null && dayIndex(entries.data[0].created_at) === dayIndex(now)
}

export async function generateNotificationCandidates(now: number, activitySamples: { occurredAt: number; kind?: 'app_active' | 'entry_saved' }[] = []): Promise<NotificationCandidate[]> {
  const [entriesResult, challengeResult, preferencesResult] = await Promise.all([
    listEntries(500), getActiveChallenge(), getNotificationPreferences(),
  ])
  if (!entriesResult.success) return []
  const entries = entriesResult.data
  const preferences = preferencesResult.success ? preferencesResult.data : null
  const momentumEnabled = preferences?.momentum === true
  const patternsEnabled = preferences?.patterns === true
  const today = dayIndex(now)
  const lastEntry = entries[0]?.created_at ?? null
  const journaledToday = lastEntry != null && dayIndex(lastEntry) === today
  const result: NotificationCandidate[] = []

  if (preferences?.journal !== false && !journaledToday) {
    const adaptive = adaptiveReminderTiming(activitySamples, now, preferences?.reminderStartHour ?? DEFAULT_SEND_HOUR)
    const hour = Math.min(preferences?.reminderEndHour ?? 21, Math.max(preferences?.reminderStartHour ?? 17, adaptive.hour))
    const eligibleAt = atLocalDay(today, hour) > now ? atLocalDay(today, hour) : atLocalDay(today + 1, hour)
    result.push(candidate('journal', `journal:${today}`, '/', eligibleAt, atLocalDay(today + 2, 23), 30))
  }

  const challenge = challengeResult.success ? challengeResult.data : null
  if (challenge && challenge.status === 'active' && challenge.last_checkin_date !== localDate(now)) {
    const eligibleAt = atLocalDay(today, 9) > now ? atLocalDay(today, 9) : atLocalDay(today + 1, 9)
    result.push(candidate('challenge', `challenge:${challenge.id}:${today}`, '/challenge', eligibleAt, atLocalDay(today + 2, 9), 60))
  }

  if (lastEntry != null) {
    for (const days of [3, 7, 30] as const) {
      const due = atLocalDay(dayIndex(lastEntry) + days, 10)
      if (now < due + DAY_MS) {
        result.push(candidate('reengagement', `reengagement:d${days}:${dayIndex(lastEntry)}`, '/entry', due, due + DAY_MS, 20 - days))
      }
    }
  }

  const digest = generateDigest(entries, now)
  if (digest) result.push(candidate('digest', `digest:${digest.weekStart}`, '/digest', atLocalDay(today, 9), atLocalDay(today + 7, 9), 80))

  if (momentumEnabled && detectMomentum(entries, now)) {
    const week = Math.floor(today / 7)
    result.push(candidate('momentum', `momentum:${week}`, '/trends', atLocalDay(today, 18), atLocalDay(today + 7, 21), 50))
  }
  if (patternsEnabled && detectWeeklyRhythm(entries, now)) {
    const week = Math.floor(today / 7)
    result.push(candidate('pattern', `pattern:${week}`, '/trends', atLocalDay(today, 18), atLocalDay(today + 7, 21), 40))
  }
  return result
}