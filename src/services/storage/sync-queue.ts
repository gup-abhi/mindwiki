import { runtimeStoreBridge } from '@/services/runtime/store-bridge'
import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { getSetting, setSetting } from './settings'
import { SYNCED_TABLES } from '@/services/sync/conflict'

const BACKFILL_KEY = 'sync:backfilled'
const OUTBOX_RECONCILED_KEY = 'sync:outbox_reconciled_v2'
const SYNC_TABLE_SET = new Set<string>(SYNCED_TABLES)

export function isDevSeedRecordId(recordId: string): boolean {
  return recordId.startsWith('seed-') || recordId.startsWith('seed-trend-')
}

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
 * Direct callers receive a best-effort Result; transactional callers should use
 * enqueueUpsertInTransaction so a queue failure rolls back the source mutation.
 */
export async function enqueueUpsert(
  tableName: string,
  recordId: string,
  db: SqliteDatabase = getDb(),
  notify = true
): Promise<Result<void>> {
  if (isDevSeedRecordId(recordId)) return ok(undefined)
  try {
    await db.execute(
      `INSERT INTO sync_queue (id, table_name, record_id, operation, created_at, synced_at)
       VALUES (?, ?, ?, 'upsert', ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         operation = 'upsert',
         created_at = MAX(sync_queue.created_at + 1, excluded.created_at),
         synced_at = NULL`,
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

/** Enqueue within a caller-owned transaction; queue failure aborts that transaction. */
export async function enqueueUpsertInTransaction(
  tableName: string,
  recordId: string,
  tx: SqliteDatabase
): Promise<void> {
  const queued = await enqueueUpsert(tableName, recordId, tx, false)
  if (!queued.success) throw new Error(queued.error.code)
}

/** Wake sync after a committed local write. Kept separate from transactional
 * queue SQL so callers can notify only after their transaction commits. */
export function notifySyncPending(): void {
  try {
    runtimeStoreBridge().notifySyncPending()
  } catch {
    // A UI/sync signal failure must not affect committed local data.
  }
}

/**
 * One-time backfill: enqueue every existing row of the given tables so data
 * written before sync existed gets uploaded on the first sync. Guarded by a
 * settings flag — it runs once, because re-running would reset synced_at and
 * re-upload everything. Source scans and queue rows commit with the marker.
 */
export async function backfillSyncQueue(
  tables: readonly string[],
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    if (tables.some((table) => !SYNC_TABLE_SET.has(table))) {
      return err('SYNC_BACKFILL_FAILED', 'Unsupported sync table')
    }
    const done = await getSetting(BACKFILL_KEY, db)
    if (!done.success) return err('SYNC_BACKFILL_FAILED', 'Failed to read sync backfill state', done.error)
    if (done.data === '1') return ok(0)

    let queued = 0
    await db.transaction(async (tx) => {
      for (const table of tables) {
        const rows = await tx.execute(
          `SELECT source.id FROM ${table} source
           WHERE NOT EXISTS (SELECT 1 FROM sync_queue q WHERE q.id = ? || source.id)`,
          [table + ':']
        )
        for (const row of rows.rows) {
          const recordId = String(row.id)
          if (isDevSeedRecordId(recordId)) continue
          await enqueueUpsertInTransaction(table, recordId, tx)
          queued++
        }
      }
      const marked = await setSetting(BACKFILL_KEY, '1', tx)
      if (!marked.success) throw new Error(marked.error.code)
    })
    if (queued > 0) notifySyncPending()
    return ok(queued)
  } catch (e) {
    return err('SYNC_BACKFILL_FAILED', 'Failed to backfill sync queue', e)
  }
}

/** Repair source rows that predate or missed the transactional outbox. */
export async function reconcileSyncQueue(
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    const done = await getSetting(OUTBOX_RECONCILED_KEY, db)
    if (!done.success) return err('SYNC_RECONCILE_FAILED', 'Failed to read sync reconciliation state', done.error)
    if (done.data === '1') return ok(0)

    let queued = 0
    await db.transaction(async (tx) => {
      const legacy = await tx.execute(
        "SELECT id, table_name, record_id, operation, created_at, synced_at FROM sync_queue WHERE id LIKE 'sq:%'"
      )
      for (const row of legacy.rows) {
        if (String(row.operation) !== 'upsert') throw new Error('SYNC_QUEUE_OPERATION_UNSUPPORTED')
        await tx.execute('DELETE FROM sync_queue WHERE id = ?', [String(row.id)])
      }

      for (const table of SYNCED_TABLES) {
        const rows = await tx.execute(
          `SELECT source.id, q.id AS queue_id, q.synced_at FROM ${table} source
           LEFT JOIN sync_queue q ON q.id = ? || source.id`,
          [table + ':']
        )
        for (const row of rows.rows) {
          const recordId = String(row.id)
          if (isDevSeedRecordId(recordId)) {
            if (row.queue_id != null) await tx.execute('DELETE FROM sync_queue WHERE id = ?', [String(row.queue_id)])
            continue
          }
          if (row.queue_id != null && row.synced_at == null) continue
          await enqueueUpsertInTransaction(table, recordId, tx)
          queued++
        }
      }
      const marked = await setSetting(OUTBOX_RECONCILED_KEY, '1', tx)
      if (!marked.success) throw new Error(marked.error.code)
    })
    if (queued > 0) notifySyncPending()
    return ok(queued)
  } catch (e) {
    return err('SYNC_RECONCILE_FAILED', 'Failed to reconcile sync outbox', e)
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
