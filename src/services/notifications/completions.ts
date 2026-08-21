import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'
import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { type ReflectionCompletion, type ReflectionCompletionSource } from './types'

function rowToCompletion(row: Record<string, unknown>): ReflectionCompletion {
  return {
    id: String(row.id),
    source: String(row.source) as ReflectionCompletionSource,
    durableId: String(row.durable_id),
    completedAt: Number(row.completed_at),
  }
}

export async function recordReflectionCompletion(
  source: ReflectionCompletionSource,
  durableId: string,
  completedAt = Date.now(),
  db?: SqliteDatabase
): Promise<Result<ReflectionCompletion>> {
  try {
    const database = db ?? getDb()
    const id = randomUUID()
    await database.execute(
      `INSERT INTO reflection_completions (id, source, durable_id, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source, durable_id) DO NOTHING`,
      [id, source, durableId, completedAt, Date.now()]
    )
    const row = await database.execute(
      'SELECT id, source, durable_id, completed_at FROM reflection_completions WHERE source = ? AND durable_id = ?',
      [source, durableId]
    )
    if (!row.rows[0]) return err('REFLECTION_COMPLETION_NOT_FOUND', 'Reflection completion was not stored')
    return ok(rowToCompletion(row.rows[0]))
  } catch (e) {
    return err('REFLECTION_COMPLETION_WRITE_FAILED', 'Failed to record reflection completion', e)
  }
}

export async function listReflectionCompletions(
  since: number,
  until = Number.MAX_SAFE_INTEGER,
  db?: SqliteDatabase
): Promise<Result<ReflectionCompletion[]>> {
  try {
    const database = db ?? getDb()
    const result = await database.execute(
      'SELECT id, source, durable_id, completed_at FROM reflection_completions WHERE completed_at >= ? AND completed_at < ? ORDER BY completed_at ASC',
      [since, until]
    )
    return ok(result.rows.map(rowToCompletion))
  } catch (e) {
    return err('REFLECTION_COMPLETION_READ_FAILED', 'Failed to read reflection completions', e)
  }
}
