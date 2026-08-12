import { authenticatedFetch } from '@/services/auth/api-client'
import { getTokens } from '@/services/auth/token-store'
import { type SqliteDatabase } from '@/services/storage/db'
import { MIGRATIONS } from '@/services/storage/migrations'
import { pushPending, pullDelta, sync, TABLES } from '@/services/sync/engine'
import { decryptRecord } from '@/services/sync/encryption'
import { useSyncStore } from '@/store/sync.store'

jest.mock('@/services/auth/api-client', () => ({ authenticatedFetch: jest.fn() }))
jest.mock('@/services/auth/token-store', () => ({ getTokens: jest.fn() }))
// Wire-safe hex codec — merge behavior remains readable while network-boundary
// validation still sees AES-GCM-shaped hex. Cryptography is covered separately.
const mockWire = (plaintext: string) => Buffer.from(plaintext).toString('hex').padEnd(56, '0')
const mockUnwire = (ciphertext: string) => Buffer.from(ciphertext, 'hex').toString().replace(/\0+$/g, '')
jest.mock('@/services/sync/encryption', () => ({
  createSyncId: jest.fn(() => 'a'.repeat(64)),
  encryptRecord: jest.fn(async (pt: string) => ({ success: true, data: mockWire(pt) })),
  decryptRecord: jest.fn(async (blob: string) => ({ success: true, data: mockUnwire(blob) })),
  decryptLegacyRecord: jest.fn(async (blob: string) => ({ success: true, data: mockUnwire(blob) })),
}))

const mockFetch = authenticatedFetch as jest.Mock
const mockGetTokens = getTokens as jest.Mock

// Must mirror TABLES.entries.columns in engine.ts (the order applyRemote binds).
const ENTRY_COLS = [
  'id', 'created_at', 'mood', 'situation', 'thought', 'behavior',
  'closing_note', 'emotion', 'named_emotion', 'energy', 'distortion', 'mood_score', 'topic', 'topic2', 'tagged_at', 'updated_at', 'raw_text', 'source',
]


const entryRow = (id: string, over: Record<string, unknown> = {}) => {
  const row = {
    id, created_at: 1000, mood: 3, situation: 's', thought: 't', behavior: null,
    closing_note: null, emotion: null, named_emotion: null, energy: null, distortion: null,
    mood_score: null, topic: null, topic2: null, tagged_at: null, updated_at: 1000, raw_text: null,
    ...over,
  }
  row.updated_at = (over.updated_at ?? over.tagged_at ?? over.created_at ?? row.created_at) as number
  return row
}

function fakeDb() {
  const syncQueue = new Map<string, Record<string, unknown>>()
  const entries = new Map<string, Record<string, unknown>>()
  const entityRows = new Map<string, Record<string, unknown>>()
  const settings = new Map<string, string>()
  const maintenanceState = new Map<string, Record<string, unknown>>()
  // Minimal wiki_pages backing for pull tests — only the columns applyRemote
  // writes matter, but we persist everything received so test assertions can
  // read back the applied row.
  const wikiPages = new Map<string, Record<string, unknown>>()
  const skipped = new Map<string, Record<string, unknown>>()
  let failQueueWrite = false
  let failQuarantineWrite = false
  let failQuarantineClear = false
  let failCommit = false
  let failSettingKey: string | null = null

  const ENTITY_COLS = ['id', 'entry_id', 'type', 'label', 'canonical_label', 'created_at', 'updated_at']

  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      sql = sql.trim().replace(/\s+/g, ' ')
      if (/^SELECT \* FROM sync_queue WHERE synced_at IS NULL/.test(sql)) {
        const pending = [...syncQueue.values()].filter((r) => r.synced_at == null)
        return { rows: pending, rowsAffected: 0 }
      }
      if (/^INSERT INTO sync_queue/.test(sql)) {
        if (failQueueWrite) throw new Error('queue unavailable')
        const existing = syncQueue.get(String(params[0]))
        syncQueue.set(String(params[0]), {
          id: params[0], table_name: params[1], record_id: params[2], operation: 'upsert',
          created_at: existing ? Math.max(Number(existing.created_at) + 1, Number(params[3])) : params[3], synced_at: null,
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE sync_queue SET synced_at/.test(sql)) {
        const [synced_at, id] = params
        const row = syncQueue.get(String(id))
        if (row) row.synced_at = synced_at
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM wiki_pages WHERE id IN/.test(sql)) {
        const found = params.map((id) => wikiPages.get(String(id))).filter(Boolean) as Record<string, unknown>[]
        return { rows: found, rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entries WHERE id IN/.test(sql)) {
        const found = params.map((id) => entries.get(String(id))).filter(Boolean) as Record<string, unknown>[]
        return { rows: found, rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entries WHERE id = \?/.test(sql)) {
        const row = entries.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^INSERT OR REPLACE INTO entries/.test(sql)) {
        const row: Record<string, unknown> = {}
        ENTRY_COLS.forEach((c, i) => (row[c] = params[i]))
        // Simulate a single malformed row that the DB rejects (constraint / bind
        // failure), so the pull's per-record resilience can be exercised.
        if (row.id === 'poison') throw new Error('SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed')
        if (row.id === 'io-failure') throw new Error('SQLITE_IOERR: disk I/O error')
        entries.set(String(row.id), row)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^INSERT OR REPLACE INTO wiki_pages/.test(sql)) {
        const cols = WIKI_COLS
        const row: Record<string, unknown> = { id: String(params[0]) }
        cols.forEach((c, i) => (row[c] = params[i]))
        wikiPages.set(String(row.id), row)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE entries SET wiki_indexed_at = tagged_at WHERE id/.test(sql)) {
        const row = entries.get(String(params[0]))
        if (row) row.wiki_indexed_at = row.tagged_at ?? null
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      // F-02B: entry_entities sync — push uses SELECT * FROM entry_entities,
      // pull compares LWW via SELECT * FROM entry_entities WHERE id IN,
      // writes back via INSERT OR REPLACE INTO entry_entities.
      if (/^SELECT \* FROM entry_entities WHERE id = \?/.test(sql)) {
        const row = entityRows.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entry_entities WHERE id IN/.test(sql)) {
        const found = params.map((id) => entityRows.get(String(id))).filter(Boolean) as Record<string, unknown>[]
        return { rows: found, rowsAffected: 0 }
      }
      if (/^INSERT OR REPLACE INTO entry_entities/.test(sql)) {
        const row: Record<string, unknown> = {}
        ENTITY_COLS.forEach((c, i) => (row[c] = params[i]))
        entityRows.set(String(row.id), row)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^INSERT INTO belief_maintenance_state \(key, source_generation\)/.test(sql)) {
        if (!maintenanceState.has('belief')) {
          maintenanceState.set('belief', { key: 'belief', source_generation: 0 })
        }
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE belief_maintenance_state SET source_generation = source_generation \+ 1/.test(sql)) {
        const row = maintenanceState.get(String(params[0]))
        if (row) row.source_generation = Number(row.source_generation) + 1
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^SELECT source_generation FROM belief_maintenance_state/.test(sql)) {
        const row = maintenanceState.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^INSERT INTO sync_skipped/.test(sql)) {
        if (failQuarantineWrite) throw new Error('quarantine unavailable')
        // Real SQL: (table_name, record_id, updated_at, failures=1, last_attempt)
        // — four bound params; failures is a literal 1, bumped on conflict.
        const [table, recordId, updatedAt, lastAttempt] = params
        const key = `${table}:${recordId}`
        const existing = skipped.get(key)
        if (existing) {
          existing.failures = Number(existing.failures) + 1
          existing.updated_at = updatedAt
          existing.last_attempt = lastAttempt
        } else {
          skipped.set(key, {
            table_name: table, record_id: recordId, updated_at: updatedAt,
            failures: 1, last_attempt: lastAttempt,
          })
        }
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT table_name, record_id, updated_at, failures FROM sync_skipped/.test(sql)) {
        return { rows: [...skipped.values()], rowsAffected: 0 }
      }
      if (/^DELETE FROM sync_skipped WHERE table_name = \? AND record_id/.test(sql)) {
        if (failQuarantineClear) throw new Error('quarantine clear unavailable')
        const [table, recordId] = params
        skipped.delete(`${table}:${recordId}`)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^DELETE FROM sync_skipped WHERE updated_at <= \?/.test(sql)) {
        const [since] = params
        for (const [key, row] of [...skipped]) {
          if (Number(row.updated_at) <= Number(since)) skipped.delete(key)
        }
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT value FROM settings WHERE key/.test(sql)) {
        const v = settings.get(String(params[0]))
        return { rows: v == null ? [] : [{ value: v }], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings/.test(sql)) {
        if (failSettingKey === String(params[0])) throw new Error('settings unavailable')
        settings.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      const cloneMap = (map: Map<string, Record<string, unknown>>) =>
        new Map([...map].map(([id, row]) => [id, { ...row }]))
      const snapshots = {
        syncQueue: cloneMap(syncQueue),
        entries: cloneMap(entries),
        entityRows: cloneMap(entityRows),
        wikiPages: cloneMap(wikiPages),
        maintenanceState: cloneMap(maintenanceState),
        settings: new Map(settings),
      }
      try {
        await fn(db)
        if (failCommit) throw new Error('commit failed')
      } catch (error) {
        const restore = (
          target: Map<string, Record<string, unknown>>,
          snapshot: Map<string, Record<string, unknown>>
        ) => {
          target.clear()
          for (const [id, row] of snapshot) target.set(id, row)
        }
        restore(syncQueue, snapshots.syncQueue)
        restore(entries, snapshots.entries)
        restore(entityRows, snapshots.entityRows)
        restore(wikiPages, snapshots.wikiPages)
        restore(maintenanceState, snapshots.maintenanceState)
        settings.clear()
        for (const [key, value] of snapshots.settings) settings.set(key, value)
        throw error
      }
    },
    close() {},
  }
  return {
    db,
    syncQueue,
    entries,
    settings,
    entityRows,
    wikiPages,
    skipped,
    maintenanceState,
    setFailQueueWrite: (value: boolean) => { failQueueWrite = value },
    setFailQuarantineWrite: (value: boolean) => { failQuarantineWrite = value },
    setFailQuarantineClear: (value: boolean) => { failQuarantineClear = value },
    setFailCommit: (value: boolean) => { failCommit = value },
    setFailSettingKey: (value: string | null) => { failSettingKey = value },
  }
}

const deltaPage = (json: unknown): unknown => {
  const source = Array.isArray(json)
    ? { records: json, next_cursor: null }
    : json as { records?: unknown[]; next_cursor?: unknown }
  if (!source || !Array.isArray(source.records)) return source
  return {
    records: source.records.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      const record = value as Record<string, unknown>
      if (record.version !== undefined) return record
      return {
        version: 1,
        ...record,
        ciphertext: typeof record.ciphertext === 'string' ? mockWire(record.ciphertext) : record.ciphertext,
      }
    }),
    next_cursor: source.next_cursor ?? null,
  }
}

const okResp = (json: unknown) =>
  ({ success: true, data: { ok: true, status: 200, json: async () => deltaPage(json) } }) as const

// Wiki pages column order sent over the wire — must mirror
// TABLES.wiki_pages.columns in engine.ts.
const WIKI_COLS = [
  'id', 'title', 'category', 'content', 'entry_count', 'version',
  'version_history', 'created_at', 'updated_at', 'dismissed_at', 'corrected_at',
  'merged_into', 'aggregated_upto', 'regrounded_upto',
]

// Ciphertext of a wiki_pages row in wire order. omit `regrounded_upto` to
// simulate a remote leg from a pre-migration-030 device.
const wikiRow = (
  id: string,
  over: Partial<Record<(typeof WIKI_COLS)[number], unknown>> = {}
): string => {
  const base: Record<string, unknown> = {
    id,
    title: 'Anxiety',
    category: 'emotion',
    content: 'page text',
    entry_count: 0,
    version: 1,
    version_history: '[]',
    created_at: 0,
    updated_at: 1000,
    dismissed_at: null,
    corrected_at: null,
    merged_into: null,
    aggregated_upto: 0,
  }
  // Remove any explicit regrounded_upto set to undefined so the JSON omits it,
  // simulating a pre-030 payload.
  const merged = { ...base, ...over }
  if (merged.regrounded_upto === undefined) delete merged.regrounded_upto
  return JSON.stringify(merged)
}

describe('sync/engine pushPending', () => {
  beforeEach(() => mockFetch.mockReset())

  it('encrypts + PUTs each pending record and marks it synced', async () => {
    const { db, syncQueue, entries } = fakeDb()
    entries.set('e1', entryRow('e1', { tagged_at: 2000 }))
    syncQueue.set('entries:e1', {
      id: 'entries:e1', table_name: 'entries', record_id: 'e1', operation: 'upsert',
      created_at: 1, synced_at: null,
    })
    mockFetch.mockResolvedValue(okResp(null))

    const res = await pushPending('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe(`/sync/acc/v2/entries/${'a'.repeat(64)}`)
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      version: 2,
      sync_id: 'a'.repeat(64),
      table: 'entries',
      updated_at: 2000,
    })
    expect(body.record_id).toBeUndefined()
    expect(JSON.parse(mockUnwire(body.ciphertext)).id).toBe('e1')
    expect(syncQueue.get('entries:e1')?.synced_at).not.toBeNull()
  })

  it('leaves a record pending when the upload fails', async () => {
    const { db, syncQueue, entries } = fakeDb()
    entries.set('e1', entryRow('e1'))
    syncQueue.set('entries:e1', {
      id: 'entries:e1', table_name: 'entries', record_id: 'e1', operation: 'upsert',
      created_at: 1, synced_at: null,
    })
    mockFetch.mockResolvedValue({ success: true, data: { ok: false, status: 500 } })

    const res = await pushPending('mk', 'acc', db)
    expect(res.success && res.data).toBe(0)
    expect(syncQueue.get('entries:e1')?.synced_at).toBeNull()
  })
})

describe('sync/engine pullDelta', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    useSyncStore.setState({ revision: 0 })
  })

  it('applies a remote record with no local copy and advances the cursor', async () => {
    const { db, entries, settings, syncQueue } = fakeDb()
    mockFetch.mockResolvedValue(
      okResp([
        { table: 'entries', record_id: 'e2', ciphertext: JSON.stringify(entryRow('e2', { situation: 'remote' })), updated_at: 5000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(entries.get('e2')?.situation).toBe('remote')
    expect(settings.get('sync:last_pull')).toBe('5000')
    expect(syncQueue.get('entries:e2')).toMatchObject({ table_name: 'entries', record_id: 'e2' })
    // Legacy read is re-enqueued once for V2 migration; V2 pulls never echo.
    expect(mockFetch.mock.calls[0][0]).toBe('/sync/acc/delta?since=0')
    expect(useSyncStore.getState().revision).toBe(1) // signals hooks to refetch
  })

  it('does not re-enqueue a V2 pull after sync-id verification', async () => {
    const { db, entries, syncQueue } = fakeDb()
    mockFetch.mockResolvedValue(okResp({
      records: [{
        version: 2,
        table: 'entries',
        sync_id: 'a'.repeat(64),
        ciphertext: mockWire(JSON.stringify(entryRow('v2'))),
        updated_at: 5000,
      }],
      next_cursor: null,
    }))

    const res = await pullDelta('mk', 'acc', db)
    expect(res.success && res.data).toBe(1)
    expect(entries.has('v2')).toBe(true)
    expect(syncQueue.size).toBe(0)
  })

  it('canonicalizes a legacy wiki page received from an older device', async () => {
    const { db, wikiPages } = fakeDb()
    const legacy = {
      id: 'p1', title: 'Work', category: 'theme', content: 'current', entry_count: 2,
      version: 2,
      version_history: JSON.stringify([{ version: 1, content: '', updated_at: 10 }]),
      created_at: 1, updated_at: 5000, dismissed_at: null, corrected_at: null,
      merged_into: null, aggregated_upto: 0,
    }
    mockFetch.mockResolvedValue(okResp([
      { table: 'wiki_pages', record_id: 'p1', ciphertext: JSON.stringify(legacy), updated_at: 5000 },
    ]))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(wikiPages.get('p1')?.version).toBe(1)
    expect(wikiPages.get('p1')?.version_history).toBe('[]')
  })

  it('stamps a pulled tagged entry wiki-indexed so catch-up never re-synthesizes it', async () => {
    const { db, entries } = fakeDb()
    mockFetch.mockResolvedValue(
      okResp([
        { table: 'entries', record_id: 'e2', ciphertext: JSON.stringify(entryRow('e2', { tagged_at: 5000 })), updated_at: 5000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    // INSERT OR REPLACE wiped the local-only column; the pull re-stamps it from
    // tagged_at so the wiki catch-up (tagged_at IS NOT NULL AND wiki_indexed_at
    // IS NULL) never picks up a synced entry — the origin device owns its wiki.
    expect(entries.get('e2')?.wiki_indexed_at).toBe(5000)
  })

  it('skips a record whose apply throws and still applies the rest (no abort)', async () => {
    const { db, entries, settings } = fakeDb()
    mockFetch.mockResolvedValue(
      okResp([
        { table: 'entries', record_id: 'ok1', ciphertext: JSON.stringify(entryRow('ok1', { situation: 'first' })), updated_at: 4000 },
        { table: 'entries', record_id: 'poison', ciphertext: JSON.stringify(entryRow('poison')), updated_at: 5000 },
        { table: 'entries', record_id: 'ok2', ciphertext: JSON.stringify(entryRow('ok2', { situation: 'third' })), updated_at: 6000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    // The poison row must not abort the pull: both good rows land and the cursor
    // advances past the batch (regression test for the mid-loop throw that wedged
    // sync at a partial state and never advanced the cursor).
    expect(res.success && res.data).toBe(2)
    expect(entries.get('ok1')?.situation).toBe('first')
    expect(entries.get('ok2')?.situation).toBe('third')
    expect(entries.has('poison')).toBe(false)
    expect(settings.get('sync:last_pull')).toBe('6000')
  })

  it('aborts on a generic local SQL failure without advancing the cursor', async () => {
    const { db, entries, settings } = fakeDb()
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'io-failure', ciphertext: JSON.stringify(entryRow('io-failure', { updated_at: 5000 })), updated_at: 5000 },
    ]))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success).toBe(false)
    expect(entries.has('io-failure')).toBe(false)
    expect(settings.get('sync:last_pull')).toBeUndefined()
    expect(settings.get('sync:pull_state')).toBeUndefined()
  })

  it('rolls back a remote source write when transaction commit fails', async () => {
    const { db, entries, settings, syncQueue, setFailCommit } = fakeDb()
    setFailCommit(true)
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'commit-failure', ciphertext: JSON.stringify(entryRow('commit-failure', { updated_at: 5000 })), updated_at: 5000 },
    ]))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success).toBe(false)
    expect(entries.has('commit-failure')).toBe(false)
    expect(syncQueue.has('entries:commit-failure')).toBe(false)
    expect(settings.get('sync:last_pull')).toBeUndefined()
  })

  it('applies a post-merge entry update after the original cursor', async () => {
    const { db, entries, settings } = fakeDb()
    entries.set('e1', entryRow('e1', { topic: 'Job pressure', updated_at: 1000 }))
    settings.set('sync:last_pull', '1000')
    mockFetch.mockResolvedValue(
      okResp([
        {
          table: 'entries',
          record_id: 'e1',
          ciphertext: JSON.stringify(entryRow('e1', { topic: 'Work stress', updated_at: 2000 })),
          updated_at: 2000,
        },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(entries.get('e1')?.topic).toBe('Work stress')
    expect(settings.get('sync:last_pull')).toBe('2000')
  })

  it('advances the watermark for valid authenticated records that lose LWW', async () => {
    const { db, entries, settings } = fakeDb()
    entries.set('local-newer', entryRow('local-newer', { updated_at: 9000 }))
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'local-newer', ciphertext: JSON.stringify(entryRow('local-newer', { updated_at: 5000 })), updated_at: 5000 },
    ]))

    const res = await pullDelta('mk', 'acc', db)
    expect(res.success && res.data).toBe(0)
    expect(settings.get('sync:last_pull')).toBe('5000')
  })

  it('skips malformed remote envelopes and malformed decrypted JSON while applying later valid records', async () => {
    const { db, entries, settings } = fakeDb()
    mockFetch.mockResolvedValue(
      okResp({
        records: [
          null,
          { table: 'entries', record_id: '', ciphertext: '{}', updated_at: -1 },
          { table: 'entries', record_id: 'bad-json', ciphertext: '{', updated_at: 4500 },
          { table: 'entries', record_id: 'ok', ciphertext: JSON.stringify(entryRow('ok', { situation: 'valid' })), updated_at: 5000 },
        ],
        next_cursor: null,
      })
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(entries.get('ok')?.situation).toBe('valid')
    expect(settings.get('sync:last_pull')).toBe('5000')
  })

  it('follows paginated delta responses without exposing the cursor to storage', async () => {
    const { db, entries } = fakeDb()
    mockFetch
      .mockResolvedValueOnce(okResp({
        records: [{ table: 'entries', record_id: 'one', ciphertext: JSON.stringify(entryRow('one')), updated_at: 4000 }],
        next_cursor: 'opaque-cursor',
      }))
      .mockResolvedValueOnce(okResp({
        records: [{ table: 'entries', record_id: 'two', ciphertext: JSON.stringify(entryRow('two')), updated_at: 5000 }],
        next_cursor: null,
      }))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(2)
    expect(entries.has('one')).toBe(true)
    expect(entries.has('two')).toBe(true)
    expect(mockFetch.mock.calls[1][0]).toBe('/sync/acc/delta?since=0&cursor=opaque-cursor')
  })

  it('rejects a repeated opaque cursor without advancing the watermark', async () => {
    const { db, settings } = fakeDb()
    mockFetch
      .mockResolvedValueOnce(okResp({ records: [], next_cursor: 'repeat' }))
      .mockResolvedValueOnce(okResp({ records: [], next_cursor: 'repeat' }))

    const res = await pullDelta('mk', 'acc', db)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('SYNC_PULL_FAILED')
    expect(settings.get('sync:last_pull')).toBeUndefined()
  })

  it('skips a remote record older than the local copy (last-write-wins)', async () => {
    const { db, entries } = fakeDb()
    entries.set('e3', entryRow('e3', { created_at: 9000, situation: 'local-newer' }))
    mockFetch.mockResolvedValue(
      okResp([
        { table: 'entries', record_id: 'e3', ciphertext: JSON.stringify(entryRow('e3', { situation: 'remote-older' })), updated_at: 5000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)
    expect(res.success && res.data).toBe(0)
    expect(entries.get('e3')?.situation).toBe('local-newer')
    expect(useSyncStore.getState().revision).toBe(0) // nothing applied → no refetch signal
  })
})

describe('sync/engine sync()', () => {
  beforeEach(() => mockGetTokens.mockReset())

  it('refuses to sync without a session', async () => {
    mockGetTokens.mockResolvedValue(null)
    const res = await sync()
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('NOT_AUTHENTICATED')
  })

  it('backfills regrounded_upto=0 for a legacy wiki_pages payload (pre-migration-030)', async () => {
    const { db, wikiPages } = fakeDb()
    mockFetch.mockResolvedValue(
      okResp([
        // Remote device predates migration 030 — its payload omits regrounded_upto.
        { table: 'wiki_pages', record_id: 'w1', ciphertext: wikiRow('w1'), updated_at: 5000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(wikiPages.get('w1')?.title).toBe('Anxiety')
    // applyRemote backfills the missing column so the NOT NULL DEFAULT clause holds.
    expect(wikiPages.get('w1')?.regrounded_upto).toBe(0)
  })

  it('preserves a non-zero regrounded_upto on a modern wiki_pages payload', async () => {
    const { db, wikiPages } = fakeDb()
    mockFetch.mockResolvedValue(
      okResp([
        { table: 'wiki_pages', record_id: 'w1', ciphertext: wikiRow('w1', { regrounded_upto: 7 }), updated_at: 5000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(wikiPages.get('w1')?.regrounded_upto).toBe(7)
  })
})

describe('sync/engine pullDelta resume + quarantine', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    useSyncStore.setState({ revision: 0, restoring: false })
  })

  // Hardcoded mirror of MAX_DELTA_PAGES in engine.ts (not exported).
  const MAX_PAGES = 512

  it('pauses at the page cap, persists a resume cursor, and completes without a wedge', async () => {
    const { db, entries, settings } = fakeDb()
    const queue: unknown[] = []
    for (let p = 0; p < MAX_PAGES; p++) {
      const records = Array.from({ length: 8 }, (_, i) => ({
        table: 'entries',
        record_id: `p${p}r${i}`,
        ciphertext: JSON.stringify(entryRow(`p${p}r${i}`, { updated_at: p * 10 + i })),
        updated_at: p * 10 + i,
      }))
      queue.push(okResp({ records, next_cursor: `c${p + 1}` }))
    }
    queue.push(okResp({
      records: Array.from({ length: 8 }, (_, i) => ({
        table: 'entries',
        record_id: `tail${i}`,
        ciphertext: JSON.stringify(entryRow(`tail${i}`, { updated_at: 10000 + i })),
        updated_at: 10000 + i,
      })),
      next_cursor: null,
    }))
    mockFetch.mockImplementation(async () => queue.shift() ?? okResp({ records: [], next_cursor: null }))

    // Pass 1: exactly MAX_PAGES pages fetched, cursor persisted, no error.
    useSyncStore.setState({ restoring: true })
    const p1 = await pullDelta('mk', 'acc', db)
    expect(p1.success).toBe(true)
    if (p1.success) expect(p1.data).toBe(MAX_PAGES * 8)
    const state1 = JSON.parse(settings.get('sync:pull_state') as string)
    expect(state1.since).toBe(0) // window not complete → cursor un-advanced
    expect(state1.cursor).toBe(`c${MAX_PAGES}`)
    expect(state1.windowMax).toBe((MAX_PAGES - 1) * 10 + 7)
    expect(useSyncStore.getState().restoring).toBe(true) // restore UI stays until drained

    // Pass 2: resumes from the stored cursor and completes the window.
    const p2 = await pullDelta('mk', 'acc', db)
    expect(p2.success).toBe(true)
    if (p2.success) expect(p2.data).toBe(8)
    const state2 = JSON.parse(settings.get('sync:pull_state') as string)
    expect(state2.cursor).toBeNull()
    expect(state2.windowMax).toBe(0)
    expect(state2.since).toBe(10007) // max updated_at over the whole window
    expect(entries.has('tail7')).toBe(true)
    expect(useSyncStore.getState().restoring).toBe(false)
  })

  it('quarantines a record that fails to decrypt, retries it, and drops it after the attempt budget', async () => {
    const { db, settings } = fakeDb()
    const badCipher = 'a'.repeat(56)
    ;(decryptRecord as jest.Mock).mockImplementation(async (blob: string) =>
      blob === badCipher
        ? { success: false, error: { code: 'DECRYPT_FAILED', message: 'x' } }
        : { success: true, data: mockUnwire(blob) }
    )

    // Pass 1: bad (ts 9000) + good (ts 5000). The bad row must not block the
    // good one, and must not advance the cursor.
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'bad', ciphertext: badCipher, updated_at: 9000 },
      { table: 'entries', record_id: 'good', ciphertext: JSON.stringify(entryRow('good', { updated_at: 5000 })), updated_at: 5000 },
    ]))
    const p1 = await pullDelta('mk', 'acc', db)
    expect(p1.success && p1.data).toBe(1)
    expect(settings.get('sync:last_pull')).toBe('5000')

    // Pass 2: bad is re-fetched (ts still above the cursor) and fails again.
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'bad', ciphertext: badCipher, updated_at: 9000 },
    ]))
    const p2 = await pullDelta('mk', 'acc', db)
    expect(p2.success && p2.data).toBe(0)
    expect(settings.get('sync:last_pull')).toBe('5000')

    // Pass 3: retry budget exhausted → permanent drop, cursor advances past it.
    const p3 = await pullDelta('mk', 'acc', db)
    expect(p3.success && p3.data).toBe(0)
    expect(settings.get('sync:last_pull')).toBe('9000')
  })

  it('quarantines a row whose apply throws and only advances past it after retries are exhausted', async () => {
    const { db, settings } = fakeDb()
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'poison', ciphertext: JSON.stringify(entryRow('poison', { updated_at: 9000 })), updated_at: 9000 },
    ]))

    const p1 = await pullDelta('mk', 'acc', db)
    expect(p1.success && p1.data).toBe(0)
    expect(settings.get('sync:last_pull')).toBe('0') // failed row excluded from cursor

    const p2 = await pullDelta('mk', 'acc', db)
    expect(settings.get('sync:last_pull')).toBe('0')

    const p3 = await pullDelta('mk', 'acc', db)
    expect(p3.success && p3.data).toBe(0)
    expect(settings.get('sync:last_pull')).toBe('9000')
  })

  it('clears quarantine on a later successful apply', async () => {
    const { db, settings, skipped } = fakeDb()
    const badCipher = 'a'.repeat(56)
    ;(decryptRecord as jest.Mock).mockImplementation(async (blob: string) =>
      blob === badCipher
        ? { success: false, error: { code: 'DECRYPT_FAILED', message: 'x' } }
        : { success: true, data: mockUnwire(blob) }
    )
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'flaky', ciphertext: badCipher, updated_at: 9000 },
    ]))
    await pullDelta('mk', 'acc', db)
    expect(skipped.size).toBe(1)

    // The record recovers — now it decrypts and applies; quarantine is cleared
    // and the cursor advances past it.
    ;(decryptRecord as jest.Mock).mockImplementation(async (blob: string) => ({
      success: true,
      data: mockUnwire(blob),
    }))
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'flaky', ciphertext: JSON.stringify(entryRow('flaky', { updated_at: 9000 })), updated_at: 9000 },
    ]))
    const res = await pullDelta('mk', 'acc', db)
    expect(res.success && res.data).toBe(1)
    expect(skipped.size).toBe(0)
    expect(settings.get('sync:last_pull')).toBe('9000')
  })

  it('treats quarantine persistence failure as fatal and keeps the cursor unchanged', async () => {
    const { db, settings, setFailQuarantineWrite } = fakeDb()
    setFailQuarantineWrite(true)
    ;(decryptRecord as jest.Mock).mockResolvedValue({ success: false, error: { code: 'DECRYPT_FAILED', message: 'x' } })
    mockFetch.mockResolvedValue(okResp([
      { version: 2, table: 'entries', sync_id: 'a'.repeat(64), ciphertext: 'a'.repeat(56), updated_at: 9000 },
    ]))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('SYNC_QUARANTINE_FAILED')
    expect(settings.get('sync:last_pull')).toBeUndefined()
  })

  it('treats quarantine clearing failure as fatal and keeps the cursor unchanged', async () => {
    const { db, skipped, settings, setFailQuarantineClear } = fakeDb()
    skipped.set('entries:flaky', {
      table_name: 'entries', record_id: 'flaky', updated_at: 9000, failures: 1, last_attempt: 1,
    })
    setFailQuarantineClear(true)
    ;(decryptRecord as jest.Mock).mockImplementation(async (blob: string) => ({
      success: true,
      data: mockUnwire(blob),
    }))
    mockFetch.mockResolvedValue(okResp([
      { table: 'entries', record_id: 'flaky', ciphertext: JSON.stringify(entryRow('flaky', { updated_at: 9000 })), updated_at: 9000 },
    ]))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('SYNC_QUARANTINE_CLEAR_FAILED')
    expect(settings.get('sync:last_pull')).toBeUndefined()
  })

  it('rolls back pull-state persistence when the legacy cursor write fails', async () => {
    const { db, settings, setFailSettingKey } = fakeDb()
    settings.set('sync:last_pull', '1000')
    setFailSettingKey('sync:last_pull')
    mockFetch.mockResolvedValue(okResp({ records: [], next_cursor: null }))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('SYNC_PULL_STATE_FAILED')
    expect(settings.get('sync:last_pull')).toBe('1000')
    expect(settings.get('sync:pull_state')).toBeUndefined()
  })

  it('seeds the pull state from the legacy sync:last_pull cursor', async () => {
    const { db, settings } = fakeDb()
    settings.set('sync:last_pull', '1000')
    mockFetch.mockResolvedValue(okResp({ records: [], next_cursor: null }))

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success).toBe(true)
    expect(mockFetch.mock.calls[0][0]).toBe('/sync/acc/delta?since=1000')
    const state = JSON.parse(settings.get('sync:pull_state') as string)
    expect(state.since).toBe(1000)
    expect(state.cursor).toBeNull()
  })
})

describe('sync/engine F-02B entry_entities effective-label sync', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    useSyncStore.setState({ revision: 0 })
  })

  const entityRow = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    entry_id: 'e1',
    type: 'belief',
    label: 'I am unlovable',
    canonical_label: 'I am unworthy',
    created_at: 1000,
    updated_at: 2000,
    ...over,
  })

  it('push PUTs an entry_entities row with canonical_label + updated_at via the LWW watermark', async () => {
    const { db, syncQueue, entityRows } = fakeDb()
    entityRows.set('e1:belief:i am unlovable', entityRow('e1:belief:i am unlovable'))
    syncQueue.set('entry_entities:e1:belief:i am unlovable', {
      id: 'entry_entities:e1:belief:i am unlovable',
      table_name: 'entry_entities', record_id: 'e1:belief:i am unlovable',
      operation: 'upsert', created_at: 1, synced_at: null,
    })
    mockFetch.mockResolvedValue(okResp(null))

    const res = await pushPending('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe(`/sync/acc/v2/entry_entities/${'a'.repeat(64)}`)
    expect(JSON.parse(init.body)).toMatchObject({
      version: 2,
      sync_id: 'a'.repeat(64),
      table: 'entry_entities',
      updated_at: 2000,
    })
    expect(JSON.parse(init.body).record_id).toBeUndefined()
    const decrypted = JSON.parse(mockUnwire(JSON.parse(init.body).ciphertext))
    expect(decrypted.canonical_label).toBe('I am unworthy')
    expect(decrypted.updated_at).toBe(2000)
  })

  it('pull writes a remote entry_entities row including canonical_label + updated_at', async () => {
    const { db, entityRows, settings } = fakeDb()
    mockFetch.mockResolvedValue(
      okResp([
        {
          table: 'entry_entities',
          record_id: 'ent1',
          ciphertext: JSON.stringify(entityRow('ent1')),
          updated_at: 2000,
        },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(entityRows.get('ent1')?.canonical_label).toBe('I am unworthy')
    expect(entityRows.get('ent1')?.updated_at).toBe(2000)
    expect(settings.get('sync:last_pull')).toBe('2000')
  })

  it('pull derives updated_at + canonical_label for a legacy payload from a pre-030 device', async () => {
    const { db, entityRows } = fakeDb()
    // A pre-030 row carries only {id, entry_id, type, label, created_at}.
    const legacyRow: Record<string, unknown> = {
      id: 'ent1', entry_id: 'e1', type: 'belief', label: 'I am unlovable', created_at: 1500,
    }
    mockFetch.mockResolvedValue(
      okResp([
        { table: 'entry_entities', record_id: 'ent1', ciphertext: JSON.stringify(legacyRow), updated_at: 1500 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    // updated_at was derived from created_at (applyRemote fill-in for legacy);
    // canonical_label = null so the raw label is its own canonical identity.
    expect(entityRows.get('ent1')?.updated_at).toBe(1500)
    expect(entityRows.get('ent1')?.canonical_label).toBeNull()
  })
})

describe('sync/engine sync allowlist vs schema (trap guard)', () => {
  // The sync column allowlist (TABLES) and the SQLite schema (MIGRATIONS) are
  // maintained separately. A column added to the schema but not to TABLES
  // silently drops from sync (applyRemote binds TABLES columns only); a TABLES
  // column removed from the schema breaks every INSERT. This guard cross-checks
  // both directions: TABLES must be a subset of the schema, and every schema
  // column that is not synced must be a declared local-only column.
  function schemaColumns(): Map<string, Set<string>> {
    const cols = new Map<string, Set<string>>()
    const add = (t: string, c: string) => {
      if (!cols.has(t)) cols.set(t, new Set())
      cols.get(t)!.add(c)
    }
    for (const m of MIGRATIONS) {
      for (const stmt of m.statements) {
        const create = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\)\s*$/.exec(stmt)
        if (create) {
          for (const mm of create[2].matchAll(/\b(\w+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/g)) {
            add(create[1], mm[1])
          }
          continue
        }
        const alter = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(stmt)
        if (alter) add(alter[1], alter[2])
      }
    }
    return cols
  }

  // Columns deliberately NOT synced (device-local bookkeeping). Adding a schema
  // column that lands here without also declaring it is the trap this guards.
  const LOCAL_ONLY: Record<string, string[]> = {
    entries: ['wiki_indexed_at', 'graph_indexed_at'],
  }

  const expectColumn = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg)
  }

  it('every TABLES column exists in the schema', () => {
    const schema = schemaColumns()
    for (const [table, cfg] of Object.entries(TABLES)) {
      const actual = schema.get(table)
      expectColumn(!!actual, `table ${table} missing from schema`)
      for (const col of cfg.columns) {
        expectColumn(actual!.has(col), `sync allowlist column ${table}.${col} not in schema`)
      }
    }
  })

  it('every schema column of a synced table is either synced or declared local-only', () => {
    const schema = schemaColumns()
    for (const table of Object.keys(TABLES)) {
      const actual = schema.get(table)
      if (!actual) continue
      const expectedLocal = new Set(LOCAL_ONLY[table] ?? [])
      for (const col of actual) {
        if (TABLES[table as keyof typeof TABLES].columns.includes(col)) continue
        expectColumn(
          expectedLocal.has(col),
          `schema column ${table}.${col} is neither in the sync allowlist nor declared local-only`
        )
      }
    }
  })
})
describe('sync/engine pullDelta equal-timestamp LWW (6e)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    useSyncStore.setState({ revision: 0, restoring: false })
  })

  it('does not re-apply an own push (identical content, equal ts)', async () => {
    const { db, entries, settings, syncQueue } = fakeDb()
    entries.set('e1', entryRow('e1', { updated_at: 1000 }))
    mockFetch.mockResolvedValue(
      okResp([
        { version: 2, table: 'entries', sync_id: 'a'.repeat(64), ciphertext: mockWire(JSON.stringify(entryRow('e1', { updated_at: 1000 }))), updated_at: 1000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(0) // own blob — no churn, no re-push
    expect(entries.get('e1')?.situation).toBe('s')
    expect(syncQueue.has('entries:e1')).toBe(false)
    expect(settings.get('sync:last_pull')).toBe('1000')
  })

  it('adopts a different writer when remote content wins the tie', async () => {
    const { db, entries, settings } = fakeDb()
    entries.set('e1', entryRow('e1', { updated_at: 1000 }))
    mockFetch.mockResolvedValue(
      okResp([
        { version: 2, table: 'entries', sync_id: 'a'.repeat(64), ciphertext: mockWire(JSON.stringify(entryRow('e1', { updated_at: 1000, situation: 'zzz other device' }))), updated_at: 1000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success && res.data).toBe(1)
    expect(entries.get('e1')?.situation).toBe('zzz other device')
    expect(settings.get('sync:last_pull')).toBe('1000')
  })

  it('aborts before cursor persistence when equal-timestamp local-winner enqueue fails', async () => {
    const { db, entries, settings, setFailQueueWrite } = fakeDb()
    entries.set('e1', entryRow('e1', { updated_at: 1000, situation: 'zzz local winner' }))
    setFailQueueWrite(true)
    mockFetch.mockResolvedValue(
      okResp([
        { version: 2, table: 'entries', sync_id: 'a'.repeat(64), ciphertext: mockWire(JSON.stringify(entryRow('e1', { updated_at: 1000, situation: 'a' }))), updated_at: 1000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    expect(res.success).toBe(false)
    expect(settings.get('sync:last_pull')).toBeUndefined()
    expect(settings.get('sync:pull_state')).toBeUndefined()
  })

  it('re-pushes the local winner so the server converges on it', async () => {
    const { db, entries, settings, syncQueue } = fakeDb()
    entries.set('e1', entryRow('e1', { updated_at: 1000, situation: 'zzz local winner' }))
    mockFetch.mockResolvedValue(
      okResp([
        { version: 2, table: 'entries', sync_id: 'a'.repeat(64), ciphertext: mockWire(JSON.stringify(entryRow('e1', { updated_at: 1000, situation: 'a' }))), updated_at: 1000 },
      ])
    )

    const res = await pullDelta('mk', 'acc', db)

    
    expect(res.success && res.data).toBe(0) // local kept
    expect(entries.get('e1')?.situation).toBe('zzz local winner')
    expect(syncQueue.get('entries:e1')?.synced_at).toBeNull() // pending re-push
    expect(settings.get('sync:last_pull')).toBe('1000')
  })
})
