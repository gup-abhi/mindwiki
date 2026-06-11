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

const ENTRY_COLS = [
  'id', 'created_at', 'mood', 'situation', 'thought', 'behavior',
  'closing_note', 'emotion', 'distortion', 'mood_score', 'topic', 'tagged_at', 'source',
]

const entryRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, created_at: 1000, mood: 3, situation: 's', thought: 't', behavior: null,
  closing_note: null, emotion: null, distortion: null, mood_score: null, tagged_at: null,
  ...over,
})

function fakeDb() {
  const syncQueue = new Map<string, Record<string, unknown>>()
  const entries = new Map<string, Record<string, unknown>>()
  const settings = new Map<string, string>()

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
      if (/^SELECT \* FROM entries WHERE id = \?/.test(sql)) {
        const row = entries.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^INSERT OR REPLACE INTO entries/.test(sql)) {
        const row: Record<string, unknown> = {}
        ENTRY_COLS.forEach((c, i) => (row[c] = params[i]))
        entries.set(String(row.id), row)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT value FROM settings WHERE key/.test(sql)) {
        const v = settings.get(String(params[0]))
        return { rows: v == null ? [] : [{ value: v }], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings/.test(sql)) {
        settings.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 1 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, syncQueue, entries, settings }
}

const okResp = (json: unknown) =>
  ({ success: true, data: { ok: true, status: 200, json: async () => json } }) as const

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
})
