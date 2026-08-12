import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsertInTransaction, notifySyncPending } from './sync-queue'

/**
 * Days the user has deliberately frozen to save a streak after a missed day.
 * One row per day index. Additive + synced (last-write-wins), so the choice
 * survives and propagates between devices — the streak count is derived from
 * entries ∪ these days.
 */

/** The set of frozen day indices, for the streak computation. */
export async function listFrozenDays(db: SqliteDatabase = getDb()): Promise<Result<Set<number>>> {
  try {
    const res = await db.execute('SELECT day_index FROM streak_freezes')
    return ok(new Set(res.rows.map((r) => Number(r.day_index))))
  } catch (e) {
    return err('STREAK_FREEZE_LIST_FAILED', 'Failed to list frozen days', e)
  }
}

/**
 * Freeze the given day indices (spend that many earned freezes). Idempotent per
 * day — re-freezing a day is a no-op upsert. Enqueues each for sync.
 */
export async function freezeDays(
  dayIndices: number[],
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    const uniqueDays = [...new Set(dayIndices)]
    const now = Date.now()
    await db.transaction(async (tx) => {
      for (const day of uniqueDays) {
        const id = String(day)
        await tx.execute(
          `INSERT INTO streak_freezes (id, day_index, frozen_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
          [id, day, now, now]
        )
        await enqueueUpsertInTransaction('streak_freezes', id, tx)
      }
    })
    if (uniqueDays.length > 0) notifySyncPending()
    return ok(undefined)
  } catch (e) {
    return err('STREAK_FREEZE_WRITE_FAILED', 'Failed to freeze days', e)
  }
}

/**
 * Delete all frozen days locally. Dev/testing only — lets you reset the freeze
 * state without fighting the device clock. Local-only (no sync delete tombstone).
 */
export async function clearFrozenDays(db: SqliteDatabase = getDb()): Promise<Result<void>> {
  try {
    await db.execute('DELETE FROM streak_freezes')
    return ok(undefined)
  } catch (e) {
    return err('STREAK_FREEZE_CLEAR_FAILED', 'Failed to clear frozen days', e)
  }
}
