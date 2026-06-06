import { CryptoModule } from '@/native/CryptoModule'
import { authenticatedFetch } from '@/services/auth/api-client'
import { getTokens } from '@/services/auth/token-store'
import { rebuildGraph } from '@/services/graph/engine'
import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { getSetting, setSetting } from '@/services/storage/settings'
import { pendingUploads, markSynced, backfillSyncQueue } from '@/services/storage/sync-queue'
import { useSyncStore } from '@/store/sync.store'
import { type Result, ok, err } from '@/types/result'

import { SYNCED_TABLES, recordsToApply, type SyncTable, type Versioned } from './conflict'
import { encryptRecord, decryptRecord } from './encryption'

const LAST_PULL_KEY = 'sync:last_pull'

type Row = Record<string, unknown>

// Per-table sync config: which columns make up a record and how to read its
// effective last-modified time (entries have no updated_at column — tagging is
// the only post-create change, so max(created_at, tagged_at) is the watermark).
const TABLES: Record<SyncTable, { columns: string[]; updatedAt: (row: Row) => number }> = {
  entries: {
    columns: [
      'id', 'created_at', 'mood', 'situation', 'thought', 'behavior',
      'closing_note', 'emotion', 'distortion', 'mood_score', 'topic', 'tagged_at',
    ],
    updatedAt: (r) => Math.max(Number(r.created_at) || 0, Number(r.tagged_at) || 0),
  },
  wiki_pages: {
    columns: [
      'id', 'title', 'category', 'content', 'entry_count', 'version',
      'version_history', 'created_at', 'updated_at',
    ],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
}

function isSyncTable(t: string): t is SyncTable {
  return (SYNCED_TABLES as string[]).includes(t)
}

/** INSERT OR REPLACE a remote row directly — deliberately bypasses the storage
 *  write helpers so it does NOT re-enqueue (which would echo back on next push). */
async function applyRemote(table: SyncTable, row: Row, db: SqliteDatabase): Promise<void> {
  const cols = TABLES[table].columns
  const placeholders = cols.map(() => '?').join(', ')
  await db.execute(
    `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
    cols.map((c) => (row[c] === undefined ? null : (row[c] as never)))
  )
}

/** Local updated_at for a set of record ids (missing ids are simply absent). */
async function localUpdatedAt(
  table: SyncTable,
  ids: string[],
  db: SqliteDatabase
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (ids.length === 0) return map
  const placeholders = ids.map(() => '?').join(', ')
  const res = await db.execute(`SELECT * FROM ${table} WHERE id IN (${placeholders})`, ids)
  for (const row of res.rows) map.set(String(row.id), TABLES[table].updatedAt(row))
  return map
}

/**
 * Push every pending record: load the local row, encrypt it under a per-record
 * key, PUT the ciphertext, and stamp the queue row synced. A failure on any one
 * record leaves it pending for the next run (never throws, never loses data).
 * Returns the count uploaded.
 */
export async function pushPending(
  masterKeyHex: string,
  accountId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  const pend = await pendingUploads(db)
  if (!pend.success) return pend

  let pushed = 0
  for (const item of pend.data) {
    if (!isSyncTable(item.table_name)) {
      await markSynced(item.id, Date.now(), db) // unknown table — drop from queue
      continue
    }
    const res = await db.execute(`SELECT * FROM ${item.table_name} WHERE id = ?`, [item.record_id])
    const row = res.rows[0]
    if (!row) {
      await markSynced(item.id, Date.now(), db) // gone locally — nothing to upload
      continue
    }

    const enc = await encryptRecord(JSON.stringify(row), item.record_id, masterKeyHex)
    if (!enc.success) continue // keep pending; retry next run

    const put = await authenticatedFetch(`/sync/${accountId}/${item.table_name}/${item.record_id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ciphertext: enc.data,
        updated_at: TABLES[item.table_name].updatedAt(row),
        record_id: item.record_id,
        table: item.table_name,
      }),
    })
    if (!put.success || !put.data.ok) continue // keep pending

    await markSynced(item.id, Date.now(), db)
    pushed++
  }
  return ok(pushed)
}

interface DeltaRecord {
  table: string
  record_id: string
  ciphertext: string
  updated_at: number
}

/**
 * Pull records changed since the last cursor, decrypt them, and apply the ones
 * that win last-write-wins against the local copy. Advances the cursor to the
 * newest applied updated_at. Returns the count applied.
 */
export async function pullDelta(
  masterKeyHex: string,
  accountId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  const cursor = await getSetting(LAST_PULL_KEY, db)
  const since = cursor.success && cursor.data ? Number(cursor.data) : 0

  const resp = await authenticatedFetch(`/sync/${accountId}/delta?since=${since}`, { method: 'GET' })
  if (!resp.success) return resp
  if (!resp.data.ok) return err('SYNC_PULL_FAILED', 'Delta request failed')

  const remote = (await resp.data.json()) as DeltaRecord[]

  let applied = 0
  let maxUpdated = since
  for (const table of SYNCED_TABLES) {
    // Decrypt this table's records first; skip any that don't decrypt (tamper /
    // wrong key) rather than failing the whole pull.
    const decoded: (Versioned & { row: Row })[] = []
    for (const r of remote) {
      if (r.table !== table) continue
      const dec = await decryptRecord(r.ciphertext, r.record_id, masterKeyHex)
      if (!dec.success) continue
      decoded.push({ record_id: r.record_id, updated_at: r.updated_at, row: JSON.parse(dec.data) as Row })
    }
    if (decoded.length === 0) continue

    const local = await localUpdatedAt(table, decoded.map((d) => d.record_id), db)
    for (const d of recordsToApply(decoded, (id) => local.get(id) ?? null)) {
      await applyRemote(table, d.row, db)
      maxUpdated = Math.max(maxUpdated, d.updated_at)
      applied++
    }
  }

  await setSetting(LAST_PULL_KEY, String(maxUpdated), db)
  // Tell data hooks to refetch so a first-login pull shows up immediately
  // (and rebuild the derived graph from the now-synced entries).
  if (applied > 0) {
    await rebuildGraph()
    useSyncStore.getState().bumpRevision()
  }
  return ok(applied)
}

/**
 * One full sync pass: push local changes, then pull remote ones. Requires an
 * active session + the master key; both stay on-device. Best-effort and safe to
 * call opportunistically when online — never throws.
 */
export async function sync(): Promise<Result<{ pushed: number; pulled: number }>> {
  const tokens = await getTokens()
  if (!tokens) return err('NOT_AUTHENTICATED', 'No active session')

  let masterKeyHex: string
  try {
    masterKeyHex = await CryptoModule.getKeyFromKeychain()
  } catch (e) {
    return err('NO_MASTER_KEY', 'Master key unavailable', e)
  }

  const db = getDb()
  // One-time: enqueue any data written before sync existed, so the first sync
  // uploads the existing journal (not just new entries).
  await backfillSyncQueue(SYNCED_TABLES, db)
  const pushed = await pushPending(masterKeyHex, tokens.accountId, db)
  if (!pushed.success) return pushed
  const pulled = await pullDelta(masterKeyHex, tokens.accountId, db)
  if (!pulled.success) return pulled

  return ok({ pushed: pushed.data, pulled: pulled.data })
}
