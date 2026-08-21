import { type Result, ok, err } from '@/types/result'
import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { listReflectionCompletions } from './completions'
import { isPlannedSlot, listReflectionPlanVersions, planVersionAt } from './plan'
import { type ReflectionPlanVersion } from './types'

const DAY_MS = 86_400_000

function addLocalDays(ts: number, days: number): number {
  const date = new Date(ts)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

function slotAt(dateTs: number, hour: number): number {
  const date = new Date(dateTs)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

function localDate(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function startOfLocalDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function startOfLocalWeek(ts: number): number {
  const date = new Date(startOfLocalDay(ts))
  date.setDate(date.getDate() - date.getDay())
  return date.getTime()
}

export function plannedDatesBetween(start: number, end: number, versions: ReflectionPlanVersion[]): Set<string> {
  const planned = new Set<string>()
  for (let dateTs = start; dateTs <= end; dateTs = addLocalDays(dateTs, 1)) {
    const version = planVersionAt(versions, dateTs + 23 * 60 * 60 * 1000)
    if (!version) continue
    const at = slotAt(dateTs, version.hour)
    if (at <= end && isPlannedSlot(version, at)) planned.add(localDate(dateTs))
  }
  return planned
}

export async function getWeeklyReflectionProgress(
  now = Date.now(),
  db?: SqliteDatabase
): Promise<Result<WeeklyReflectionProgress>> {
  try {
    const database = db ?? getDb()
    const weekStart = startOfLocalWeek(now)
    const completions = await listReflectionCompletions(weekStart, now + 1, database)
    if (!completions.success) return completions
    const versions = await listReflectionPlanVersions(now + 1, database)
    if (!versions.success) return versions
    const planned = plannedDatesBetween(weekStart, now, versions.data)
    const completed = new Set(completions.data.map((item) => localDate(item.completedAt)))
    let completedPlanned = 0
    for (const date of planned) if (completed.has(date)) completedPlanned++
    return ok({ planned: planned.size, completed: completedPlanned })
  } catch (e) {
    return err('REFLECTION_PROGRESS_FAILED', 'Failed to calculate weekly reflection progress', e)
  }
}

export interface WeeklyReflectionProgress {
  planned: number
  completed: number
}
