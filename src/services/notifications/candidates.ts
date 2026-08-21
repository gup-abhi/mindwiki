import { randomUUID } from 'expo-crypto'

import { type NotificationCandidate, type NotificationPreferences, type ReflectionPlanVersion } from './types'
import { getNotificationPreferences } from './preferences'
import { listEntries } from '@/services/storage/entries'
import { listReflectionCompletions } from './completions'
import { isPlannedSlot, listReflectionPlanVersions, planVersionAt } from './plan'
const MISS_LOOKBACK_DAYS = 30

function isCompletionDate(completedDates: Set<string>, ts: number): boolean {
  return completedDates.has(localDate(ts))
}

function plannedSlotForDate(dateTs: number, versions: ReflectionPlanVersion[]): number | null {
  const version = planVersionAt(versions, dateTs + DAY_MS - 1)
  if (!version) return null
  const slot = atLocalDateHour(dateTs, version.hour)
  return isPlannedSlot(version, slot) ? slot : null
}

function hasThreeConsecutiveMisses(beforeDate: number, versions: ReflectionPlanVersion[], completedDates: Set<string>, now: number): boolean {
  let misses = 0
  for (let offset = 1; offset <= MISS_LOOKBACK_DAYS; offset++) {
    const dateTs = addLocalDays(beforeDate, -offset)
    const slot = plannedSlotForDate(dateTs, versions)
    if (slot == null || slot > now) continue
    if (isCompletionDate(completedDates, dateTs)) break
    misses++
    if (misses >= 3) return true
  }
  return false
}

function fallbackPlan(preferences: NotificationPreferences): ReflectionPlanVersion {
  return {
    id: 'current', effectiveAt: 0, enabled: preferences.enabled,
    weekdays: preferences.routineWeekdays ?? [], hour: preferences.routineHour ?? 20,
    retryDelayMinutes: preferences.retryDelayMinutes ?? 60, pausedUntil: preferences.pausedUntil,
  }
}

export function routineVersions(preferences: NotificationPreferences, history: ReflectionPlanVersion[]): ReflectionPlanVersion[] {
  return history.length > 0 ? history : [fallbackPlan(preferences)]
}

export { MISS_LOOKBACK_DAYS }


const DAY_MS = 86_400_000
const HORIZON_DAYS = 14

function localDateParts(ts: number): { year: number; month: number; day: number; weekday: number } {
  const date = new Date(ts)
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), weekday: date.getDay() }
}

export function localDate(ts: number): string {
  const parts = localDateParts(ts)
  return `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function atLocalDateHour(ts: number, hour: number): number {
  const date = new Date(ts)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

function addLocalDays(ts: number, days: number): number {
  const date = new Date(ts)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

function makeCandidate(
  kind: NotificationCandidate['kind'],
  dedupeKey: string,
  route: string,
  eligibleAt: number,
  expiresAt: number,
  priority: number
): NotificationCandidate {
  return { id: randomUUID(), kind, dedupeKey, targetRoute: route, eligibleAt, expiresAt, priority }
}

export async function hasJournalEntryToday(now: number): Promise<boolean> {
  const entries = await listEntries(1)
  return entries.success && entries.data[0] != null && localDate(entries.data[0].created_at) === localDate(now)
}

export async function generateNotificationCandidates(now: number): Promise<NotificationCandidate[]> {
  const preferencesResult = await getNotificationPreferences()
  if (!preferencesResult.success) return []
  const preferences = preferencesResult.data
  const versionsResult = await listReflectionPlanVersions(addLocalDays(now, HORIZON_DAYS + 1))
  if (!versionsResult.success) return []
  const versions = routineVersions(preferences, versionsResult.data)
  if (!preferences.enabled && versionsResult.data.length === 0) return []

  const completions = await listReflectionCompletions(addLocalDays(now, -MISS_LOOKBACK_DAYS), addLocalDays(now, HORIZON_DAYS + 1))
  if (!completions.success) return []
  const completedDates = new Set(completions.data.map((completion) => localDate(completion.completedAt)))

  const candidates: NotificationCandidate[] = []
  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const dayTs = addLocalDays(now, offset)
    const date = localDate(dayTs)
    const version = planVersionAt(versions, dayTs + DAY_MS - 1)
    if (!version) continue
    const mainAt = plannedSlotForDate(dayTs, versions)
    if (mainAt == null || mainAt <= now || isCompletionDate(completedDates, dayTs)) continue
    const expiresAt = addLocalDays(mainAt, 1)
    candidates.push(makeCandidate('routine', `routine:${date}:main`, '/entry', mainAt, expiresAt, 100))

    const retryAt = mainAt + version.retryDelayMinutes * 60_000
    if (retryAt < expiresAt && !hasThreeConsecutiveMisses(dayTs, versions, completedDates, now)) {
      candidates.push(makeCandidate('routine-retry', `routine:${date}:retry:${version.retryDelayMinutes}`, '/entry', retryAt, expiresAt, 90))
    }
  }
  return candidates
}

export function routineDateForCandidate(candidate: Pick<NotificationCandidate, 'dedupeKey'>): string | null {
  const match = /^(?:routine|routine-retry):([^:]+)/.exec(candidate.dedupeKey)
  return match?.[1] ?? null
}

export { DAY_MS }
