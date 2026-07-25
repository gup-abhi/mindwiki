import { authenticatedFetch } from '@/services/auth/api-client'
import { getTokens } from '@/services/auth/token-store'
import { type SqliteDatabase } from '@/services/storage/db'
import { pushPending, pullDelta, sync } from '@/services/sync/engine'
import { useSyncStore } from '@/store/sync.store'

jest.mock('@/services/auth/api-client', () => ({ authenticatedFetch: jest.fn() }))
jest.mock('@/services/auth/token-store', () => ({ getTokens: jest.fn() }))
// Crypto passthrough — ciphertext === plaintext JSON, so we can assert merge
// logic without exercising AES (covered by encryption.test.ts).
jest.mock('@/services/sync/encryption', () => ({
  encryptRecord: jest.fn(async (pt: string) => ({ success: true, data: pt })),
  decryptRecord: jest.fn(async (blob: string) => ({ success: true, data: blob })),
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
  // Minimal wiki_pages backing for pull tests — only the columns applyRemote
  // writes matter, but we persist everything received so test assertions can
  // read back the applied row.
  const wikiPages = new Map<string, Record<string, unknown>>()

  const ENTITY_COLS = ['id', 'entry_id', 'type', 'label', 'canonical_label', 'created_at', 'updated_at']

  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^SELECT \* FROM sync_queue WHERE synced_at IS NULL/.test(sql)) {
        const pending = [...syncQueue.values()].filter((r) => r.synced_at == null)
        return { rows: pending, rowsAffected: 0 }
      }
      if (/^UPDATE sync_queue SET synced_at/.test(sql)) {
        const [synced_at, id] = params
        const row = syncQueue.get(String(id))
        if (row) row.synced_at = synced_at
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM entries WHERE id IN/.test(sql)) {
        const found = params.map((id) => entries.get(String(id))).filter(Boolean) as Record<string, unknown>[]
        return { rows: found, rowsAffected: 0 }
      }
      if (/^SELECT \* FROM wiki_pages WHERE id IN/.test(sql)) {
        const found = params.map((id) => wikiPages.get(String(id))).filter(Boolean) as Record<string, unknown>[]
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
        if (row.id === 'poison') throw new Error('SQLITE constraint failed')
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
      if (/^SELECT value FROM settings WHERE key/.test(sql)) {
        const v = settings.get(String(params[0]))
        return { rows: v == null ? [] : [{ value: v }], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings/.test(sql)) {
        settings.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, syncQueue, entries, settings, entityRows, wikiPages }
}

const okResp = (json: unknown) =>
  ({ success: true, data: { ok: true, status: 200, json: async () => json } }) as const

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
    expect(path).toBe('/sync/acc/entries/e1')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ record_id: 'e1', table: 'entries', updated_at: 2000 })
    expect(JSON.parse(body.ciphertext).id).toBe('e1') // passthrough cipher = row JSON
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
    expect(syncQueue.size).toBe(0) // applyRemote must NOT re-enqueue (no echo)
    expect(mockFetch.mock.calls[0][0]).toBe('/sync/acc/delta?since=0')
    expect(useSyncStore.getState().revision).toBe(1) // signals hooks to refetch
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
    expect(path).toBe('/sync/acc/entry_entities/e1:belief:i am unlovable')
    expect(JSON.parse(init.body)).toMatchObject({
      record_id: 'e1:belief:i am unlovable', table: 'entry_entities',
      updated_at: 2000,
    })
    // Passthrough cipher is the row JSON — both new columns survive the trip.
    const decrypted = JSON.parse(JSON.parse(init.body).ciphertext)
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
