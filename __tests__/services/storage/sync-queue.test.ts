import { type SqliteDatabase } from '@/services/storage/db'
import {
  enqueueUpsert,
  pendingUploads,
  markSynced,
  backfillSyncQueue,
} from '@/services/storage/sync-queue'
import { useSyncStore } from '@/store/sync.store'

// In-memory fake backing exactly the queries sync-queue.ts issues, so we can
// assert real semantics (enqueue -> list -> mark synced).
function createFakeDb() {
  const rows = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^INSERT INTO sync_queue/.test(sql)) {
        const [id, table_name, record_id, created_at] = params
        rows.set(String(id), {
          id,
          table_name,
          record_id,
          operation: 'upsert',
          created_at,
          synced_at: null, // ON CONFLICT also resets synced_at to NULL
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM sync_queue WHERE synced_at IS NULL/.test(sql)) {
        const pending = [...rows.values()]
          .filter((r) => r.synced_at == null)
          .sort((a, b) => Number(a.created_at) - Number(b.created_at))
        return { rows: pending, rowsAffected: 0 }
      }
      if (/^UPDATE sync_queue SET synced_at/.test(sql)) {
        const [synced_at, id] = params
        const row = rows.get(String(id))
        if (row) row.synced_at = synced_at
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, rows }
}

describe('storage/sync-queue', () => {
  it('enqueues a pending upload', async () => {
    const { db } = createFakeDb()
    const res = await enqueueUpsert('entries', 'e1', db)
    expect(res.success).toBe(true)

    const pending = await pendingUploads(db)
    expect(pending.success && pending.data.map((q) => q.record_id)).toEqual(['e1'])
    expect(pending.success && pending.data[0].id).toBe('entries:e1')
  })

  it('signals a local change so the debounced background sync wakes', async () => {
    const { db } = createFakeDb()
    useSyncStore.setState({ pendingSignal: 0 })
    await enqueueUpsert('entries', 'e1', db)
    expect(useSyncStore.getState().pendingSignal).toBe(1)
  })

  it('collapses repeated edits of one record into a single pending row', async () => {
    const { db, rows } = createFakeDb()
    await enqueueUpsert('wiki_pages', 'p1', db)
    await enqueueUpsert('wiki_pages', 'p1', db)
    expect(rows.size).toBe(1)

    const pending = await pendingUploads(db)
    expect(pending.success && pending.data).toHaveLength(1)
  })

  it('drops a record from pending once marked synced, and re-enqueue revives it', async () => {
    const { db } = createFakeDb()
    await enqueueUpsert('entries', 'e1', db)
    await markSynced('entries:e1', Date.now(), db)

    let pending = await pendingUploads(db)
    expect(pending.success && pending.data).toHaveLength(0)

    // A later edit re-enqueues the same id and clears synced_at.
    await enqueueUpsert('entries', 'e1', db)
    pending = await pendingUploads(db)
    expect(pending.success && pending.data).toHaveLength(1)
  })

  it('never throws — returns err when the db fails', async () => {
    const db: SqliteDatabase = {
      async execute() {
        throw new Error('db down')
      },
      async transaction(fn) {
        await fn(db)
      },
      close() {},
    }
    const res = await enqueueUpsert('entries', 'e1', db)
    expect(res.success).toBe(false)
  })
})

function createBackfillDb(entryIds: string[], pageIds: string[]) {
  const syncQueue = new Map<string, Record<string, unknown>>()
  const settings = new Map<string, string>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^SELECT value FROM settings WHERE key/.test(sql)) {
        const v = settings.get(String(params[0]))
        return { rows: v == null ? [] : [{ value: v }], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings/.test(sql)) {
        settings.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT id FROM entries/.test(sql)) {
        return { rows: entryIds.map((id) => ({ id })), rowsAffected: 0 }
      }
      if (/^SELECT id FROM wiki_pages/.test(sql)) {
        return { rows: pageIds.map((id) => ({ id })), rowsAffected: 0 }
      }
      if (/^INSERT INTO sync_queue/.test(sql)) {
        const [id, table_name, record_id, created_at] = params
        syncQueue.set(String(id), { id, table_name, record_id, operation: 'upsert', created_at, synced_at: null })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM sync_queue WHERE synced_at IS NULL/.test(sql)) {
        return { rows: [...syncQueue.values()].filter((r) => r.synced_at == null), rowsAffected: 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, syncQueue, settings }
}

describe('backfillSyncQueue', () => {
  it('enqueues every existing entry + wiki page once and sets the flag', async () => {
    const { db, settings } = createBackfillDb(['e1', 'e2'], ['p1'])

    const res = await backfillSyncQueue(['entries', 'wiki_pages'], db)
    expect(res.success && res.data).toBe(3)
    expect(settings.get('sync:backfilled')).toBe('1')

    const pending = await pendingUploads(db)
    expect(pending.success && pending.data.map((q) => q.id).sort()).toEqual([
      'entries:e1',
      'entries:e2',
      'wiki_pages:p1',
    ])
  })

  it('is a no-op once the flag is set (does not re-enqueue)', async () => {
    const { db, settings } = createBackfillDb(['e1'], [])
    settings.set('sync:backfilled', '1')

    const res = await backfillSyncQueue(['entries', 'wiki_pages'], db)
    expect(res.success && res.data).toBe(0)

    const pending = await pendingUploads(db)
    expect(pending.success && pending.data).toHaveLength(0)
  })
})
