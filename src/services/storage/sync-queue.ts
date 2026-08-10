import { useSyncStore } from '@/store/sync.store'
import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { getSetting, setSetting } from './settings'

const BACKFILL_KEY = 'sync:backfilled'

export type SyncOperation = 'upsert' | 'delete'

export interface QueueItem {
  id: string
  table_name: string
  record_id: string
  operation: SyncOperation
  created_at: number
}

function rowToItem(row: Record<string, unknown>): QueueItem {
  return {
    id: String(row.id),
    table_name: String(row.table_name),
    record_id: String(row.record_id),
    operation: String(row.operation) as SyncOperation,
    created_at: Number(row.created_at),
  }
}

/**
 * Mark a record as pending E2E-encrypted upload. One pending row per
 * (table, record): the id is deterministic and a re-enqueue resets synced_at,
 * so repeated edits collapse to a single pending upload of the latest state.
 * Best-effort — a queue failure must never fail the underlying write (the engine
 * also has the local row, so a missed enqueue only delays sync, never loses data).
 */
export async function enqueueUpsert(
  tableName: string,
  recordId: string,
  db: SqliteDatabase = getDb(),
  notify = true
): Promise<Result<void>> {
  try {
    await db.execute(
      `INSERT INTO sync_queue (id, table_name, record_id, operation, created_at, synced_at)
       VALUES (?, ?, ?, 'upsert', ?, NULL)
       ON CONFLICT(id) DO UPDATE SET operation = 'upsert', created_at = excluded.created_at, synced_at = NULL`,
      [`${tableName}:${recordId}`, tableName, recordId, Date.now()]
    )
    // Wake the debounced background sync (useSync) so this change uploads on its
    // own. Best-effort signal — never affects the enqueue result.
    if (notify) notifySyncPending()
    return ok(undefined)
  } catch (e) {
    return err('SYNC_ENQUEUE_FAILED', 'Failed to enqueue record for sync', e)
  }
}

/** Wake sync after a committed local write. Kept separate from transactional
 * queue SQL so callers can notify only after their transaction commits. */
export function notifySyncPending(): void {
  try {
    useSyncStore.getState().notifyLocalChange()
  } catch {
    // A UI/sync signal failure must not affect committed local data.
  }
}

/**
 * One-time backfill: enqueue every existing row of the given tables so data
 * written before sync existed gets uploaded on the first sync. Guarded by a
 * settings flag — it runs once, because re-running would reset synced_at and
 * re-upload everything. Best-effort per row; returns the number queued.
 */
export async function backfillSyncQueue(
  tables: readonly string[],
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    const done = await getSetting(BACKFILL_KEY, db)
    if (done.success && done.data === '1') return ok(0)

    let queued = 0
    for (const table of tables) {
      const res = await db.execute(`SELECT id FROM ${table}`)
      for (const row of res.rows) {
        const r = await enqueueUpsert(table, String(row.id), db)
        if (r.success) queued++
      }
    }
    await setSetting(BACKFILL_KEY, '1', db)
    return ok(queued)
  } catch (e) {
    return err('SYNC_BACKFILL_FAILED', 'Failed to backfill sync queue', e)
  }
}

/** Records still awaiting upload (oldest first). */
export async function pendingUploads(db: SqliteDatabase = getDb()): Promise<Result<QueueItem[]>> {
  try {
    const res = await db.execute(
      'SELECT * FROM sync_queue WHERE synced_at IS NULL ORDER BY created_at ASC'
    )
    return ok(res.rows.map(rowToItem))
  } catch (e) {
    return err('SYNC_QUEUE_LIST_FAILED', 'Failed to read sync queue', e)
  }
}

/** Stamp a queue row as uploaded so it drops out of pendingUploads. When the
 * uploaded generation is supplied, a newer edit that re-queued the same record
 * remains pending instead of being acknowledged by the older in-flight PUT. */
export async function markSynced(
  id: string,
  syncedAt: number,
  db: SqliteDatabase = getDb(),
  uploadedGeneration?: number
): Promise<Result<void>> {
  try {
    if (uploadedGeneration === undefined) {
      await db.execute('UPDATE sync_queue SET synced_at = ? WHERE id = ?', [syncedAt, id])
    } else {
      await db.execute(
        'UPDATE sync_queue SET synced_at = ? WHERE id = ? AND created_at = ?',
        [syncedAt, id, uploadedGeneration]
      )
    }
    return ok(undefined)
  } catch (e) {
    return err('SYNC_QUEUE_MARK_FAILED', 'Failed to mark record synced', e)
  }
}
