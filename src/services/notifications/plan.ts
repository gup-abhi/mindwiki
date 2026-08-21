import { randomUUID } from 'expo-crypto'
import { type Result, ok, err } from '@/types/result'
import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { type NotificationPreferences, type ReflectionPlanVersion } from './types'

function rowToPlanVersion(row: Record<string, unknown>): ReflectionPlanVersion {
  let weekdays: number[] = []
  try {
    const parsed = JSON.parse(String(row.weekdays_json)) as unknown
    weekdays = Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : []
  } catch {
    weekdays = []
  }
  return {
    id: String(row.id),
    effectiveAt: Number(row.effective_at),
    enabled: Number(row.enabled) === 1,
    weekdays,
    hour: Number(row.hour),
    retryDelayMinutes: Number(row.retry_delay_minutes) as 30 | 60 | 120,
    pausedUntil: row.paused_until == null ? null : Number(row.paused_until),
  }
}

export async function listReflectionPlanVersions(
  until = Number.MAX_SAFE_INTEGER,
  db?: SqliteDatabase
): Promise<Result<ReflectionPlanVersion[]>> {
  try {
    const database = db ?? getDb()
    const result = await database.execute(
      'SELECT id, effective_at, enabled, weekdays_json, hour, retry_delay_minutes, paused_until FROM reflection_plan_versions WHERE effective_at < ? ORDER BY effective_at ASC',
      [until]
    )
    return ok(result.rows.map(rowToPlanVersion))
  } catch (e) {
    return err('REFLECTION_PLAN_READ_FAILED', 'Failed to read reflection plan history', e)
  }
}

export function planVersionAt(versions: ReflectionPlanVersion[], slotAt: number): ReflectionPlanVersion | null {
  let selected: ReflectionPlanVersion | null = null
  for (const version of versions) {
    if (version.effectiveAt <= slotAt && (!selected || version.effectiveAt > selected.effectiveAt)) selected = version
  }
  return selected
}

export function isPlannedSlot(version: ReflectionPlanVersion | null, slotAt: number): boolean {
  if (!version?.enabled) return false
  const weekday = new Date(slotAt).getDay()
  if (!version.weekdays.includes(weekday)) return false
  return version.pausedUntil == null || slotAt >= version.pausedUntil
}

export async function recordReflectionPlanVersion(
  preferences: NotificationPreferences,
  effectiveAt = Date.now(),
  db?: SqliteDatabase
): Promise<Result<void>> {
  try {
    const database = db ?? getDb()
    await database.execute(
      `INSERT INTO reflection_plan_versions
       (id, effective_at, enabled, weekdays_json, hour, retry_delay_minutes, paused_until)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), effectiveAt, preferences.enabled ? 1 : 0, JSON.stringify(preferences.routineWeekdays ?? []), preferences.routineHour ?? 20, preferences.retryDelayMinutes ?? 60, preferences.pausedUntil]
    )
    return ok(undefined)
  } catch (e) {
    return err('REFLECTION_PLAN_WRITE_FAILED', 'Failed to save reflection plan', e)
  }
}
