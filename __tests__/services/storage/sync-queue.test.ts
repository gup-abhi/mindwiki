import { type SqliteDatabase } from '@/services/storage/db'
import {
  enqueueUpsert,
  enqueueUpsertInTransaction,
  pendingUploads,
  markSynced,
  backfillSyncQueue,
  reconcileSyncQueue,
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
        const existing = rows.get(String(id))
        rows.set(String(id), {
          id,
          table_name,
          record_id,
          operation: 'upsert',
          created_at: existing
            ? Math.max(Number(existing.created_at) + 1, Number(created_at))
            : created_at,
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
        const [synced_at, id, created_at] = params
        const row = rows.get(String(id))
        if (row && (created_at == null || row.created_at === created_at)) row.synced_at = synced_at
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

  it('collapses repeated edits of one record into a single pending row with a newer generation', async () => {
    const { db, rows } = createFakeDb()
    const now = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(now)
    await enqueueUpsert('wiki_pages', 'p1', db)
    const firstGeneration = Number(rows.get('wiki_pages:p1')?.created_at)
    await enqueueUpsert('wiki_pages', 'p1', db)
    const secondGeneration = Number(rows.get('wiki_pages:p1')?.created_at)
    jest.restoreAllMocks()

    expect(rows.size).toBe(1)
    expect(secondGeneration).toBe(firstGeneration + 1)

    const pending = await pendingUploads(db)
    expect(pending.success && pending.data).toHaveLength(1)
  })

  it('keeps queue generations monotonic when the wall clock moves backward', async () => {
    const { db, rows } = createFakeDb()
    jest.spyOn(Date, 'now').mockReturnValueOnce(2000).mockReturnValueOnce(1000)
    await enqueueUpsert('entries', 'e1', db)
    await enqueueUpsert('entries', 'e1', db)
    jest.restoreAllMocks()

    expect(rows.get('entries:e1')?.created_at).toBe(2001)
  })

  it('returns an error when marking synced cannot write', async () => {
    const db: SqliteDatabase = {
      async execute() { throw new Error('db down') },
      async transaction(fn) { await fn(db) },
      close() {},
    }

    const result = await markSynced('entries:e1', Date.now(), db, 1)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('SYNC_QUEUE_MARK_FAILED')
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

  it('does not let an older upload acknowledge a newer queued edit', async () => {
    const { db, rows } = createFakeDb()
    await enqueueUpsert('entries', 'e1', db)
    const uploadedGeneration = Number(rows.get('entries:e1')?.created_at)

    // The record changes while the previous PUT is in flight.
    const queued = rows.get('entries:e1')
    if (!queued) throw new Error('missing queue row')
    queued.created_at = uploadedGeneration + 1
    queued.synced_at = null

    await markSynced('entries:e1', Date.now(), db, uploadedGeneration)

    const pending = await pendingUploads(db)
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

  it('transactional enqueue throws to abort the caller transaction without notifying', async () => {
    let rolledBack = false
    const db: SqliteDatabase = {
      async execute() {
        throw new Error('queue unavailable')
      },
      async transaction(fn) {
        try {
          await fn(db)
        } catch {
          rolledBack = true
          throw new Error('rollback')
        }
      },
      close() {},
    }
    useSyncStore.setState({ pendingSignal: 0 })

    await expect(db.transaction(async (tx) => {
      await enqueueUpsertInTransaction('entries', 'e1', tx)
    })).rejects.toThrow('rollback')

    expect(rolledBack).toBe(true)
    expect(useSyncStore.getState().pendingSignal).toBe(0)
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
      if (/^SELECT source.id FROM entries source/.test(sql)) {
        return { rows: entryIds.map((id) => ({ id })), rowsAffected: 0 }
      }
      if (/^SELECT source.id FROM wiki_pages source/.test(sql)) {
        return { rows: pageIds.map((id) => ({ id })), rowsAffected: 0 }
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

function createReconciliationDb() {
  const source = new Map<string, Map<string, Record<string, unknown>>>([
    ['entries', new Map([['e1', { id: 'e1' }], ['e2', { id: 'e2' }]])],
    ['wiki_pages', new Map([['p1', { id: 'p1' }]])],
  ])
  const queue = new Map<string, Record<string, unknown>>()
  const settings = new Map<string, string>()
  let failMarker = false

  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, ' ')
      if (/^SELECT value FROM settings WHERE key = \?/.test(normalized)) {
        const value = settings.get(String(params[0]))
        return { rows: value == null ? [] : [{ value }], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings/.test(normalized)) {
        if (failMarker) throw new Error('settings unavailable')
        settings.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT id, table_name, record_id, operation, created_at, synced_at FROM sync_queue/.test(normalized)) {
        return { rows: [...queue.values()].filter((row) => String(row.id).startsWith('sq:')), rowsAffected: 0 }
      }
      if (/^SELECT synced_at, created_at FROM sync_queue WHERE id = \?/.test(normalized)) {
        const row = queue.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^UPDATE sync_queue SET synced_at =/.test(normalized)) {
        const [syncedAt, id, createdAt] = params
        const row = queue.get(String(id))
        if (row && Number(row.created_at) === Number(createdAt)) row.synced_at = syncedAt
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE sync_queue SET operation = 'upsert'/.test(normalized)) {
        const [createdAt, id] = params
        const row = queue.get(String(id))
        if (row) {
          row.operation = 'upsert'
          row.created_at = createdAt
          row.synced_at = null
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^DELETE FROM sync_queue WHERE id =/.test(normalized)) {
        queue.delete(String(params[0]))
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT source.id FROM (\w+) source/.test(normalized)) {
        const table = normalized.match(/^SELECT source.id FROM (\w+) source/)![1]
        const rows = [...(source.get(table)?.values() ?? [])]
          .filter((row) => !queue.has(`${table}:${String(row.id)}`))
          .map((row) => ({ id: row.id }))
        return { rows, rowsAffected: 0 }
      }
      if (/^INSERT INTO sync_queue/.test(normalized)) {
        const [id, tableName, recordId, operation, createdAt, syncedAt] = params
        queue.set(String(id), {
          id,
          table_name: tableName,
          record_id: recordId,
          operation: operation ?? 'upsert',
          created_at: createdAt,
          synced_at: syncedAt ?? null,
        })
        return { rows: [], rowsAffected: 1 }
      }
      throw new Error(`unhandled SQL: ${normalized}`)
    },
    async transaction(fn) {
      const queueSnapshot = new Map([...queue].map(([id, row]) => [id, { ...row }]))
      const settingsSnapshot = new Map(settings)
      try {
        await fn(db)
      } catch (error) {
        queue.clear()
        for (const [id, row] of queueSnapshot) queue.set(id, row)
        settings.clear()
        for (const [key, value] of settingsSnapshot) settings.set(key, value)
        throw error
      }
    },
    close() {},
  }

  return { db, queue, settings, setFailMarker: (value: boolean) => { failMarker = value } }
}

describe('reconcileSyncQueue', () => {
  it('folds legacy rows, preserves canonical state, and queues missing source rows', async () => {
    const { db, queue, settings } = createReconciliationDb()
    queue.set('entries:e1', {
      id: 'entries:e1', table_name: 'entries', record_id: 'e1', operation: 'upsert', created_at: 10, synced_at: 100,
    })
    queue.set('wiki_pages:p1', {
      id: 'wiki_pages:p1', table_name: 'wiki_pages', record_id: 'p1', operation: 'upsert', created_at: 20, synced_at: null,
    })
    queue.set('sq:entries:e1', {
      id: 'sq:entries:e1', table_name: 'entries', record_id: 'e1', operation: 'upsert', created_at: 30, synced_at: null,
    })

    const result = await reconcileSyncQueue(db)

    expect(result.success && result.data).toBe(1)
    expect(queue.has('sq:entries:e1')).toBe(false)
    expect(queue.get('entries:e1')?.synced_at).toBeNull()
    expect(queue.get('wiki_pages:p1')?.synced_at).toBeNull()
    expect(queue.has('entries:e2')).toBe(true)
    expect(settings.get('sync:outbox_reconciled_v1')).toBe('1')

    const again = await reconcileSyncQueue(db)
    expect(again.success && again.data).toBe(0)
  })

  it('rolls back queue repairs and leaves the marker retryable when marker write fails', async () => {
    const { db, queue, settings, setFailMarker } = createReconciliationDb()
    setFailMarker(true)

    const result = await reconcileSyncQueue(db)

    expect(result.success).toBe(false)
    expect(queue.size).toBe(0)
    expect(settings.has('sync:outbox_reconciled_v1')).toBe(false)
  })
})

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
