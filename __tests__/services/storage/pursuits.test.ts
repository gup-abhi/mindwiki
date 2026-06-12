import { type SqliteDatabase } from '@/services/storage/db'
import {
  createPursuit,
  getPursuit,
  listPursuits,
  updatePursuit,
} from '@/services/storage/pursuits'

let mockUuidCounter = 0
jest.mock('expo-crypto', () => ({
  randomUUID: () => `id-${++mockUuidCounter}`,
}))

// In-memory fake backing the exact queries pursuits.ts issues. sync_queue inserts
// are intentionally unhandled — enqueueUpsert swallows the error (best-effort).
function createFakeDb() {
  const pursuits = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^INSERT INTO pursuits/.test(sql)) {
        const [id, title, details, status, checkin_question, wiki_page_id,
          created_at, updated_at, last_mentioned_at, last_checkin_at] = params
        pursuits.set(String(id), {
          id, title, details, status, checkin_question, wiki_page_id,
          created_at, updated_at, last_mentioned_at, last_checkin_at,
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM pursuits WHERE id/.test(sql)) {
        const row = pursuits.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM pursuits ORDER BY last_mentioned_at/.test(sql)) {
        const rows = [...pursuits.values()].sort(
          (a, b) => Number(b.last_mentioned_at) - Number(a.last_mentioned_at)
        )
        return { rows, rowsAffected: 0 }
      }
      if (/^UPDATE pursuits SET /.test(sql)) {
        // Dynamic SET: zip the "col = ?" names with params; last param is the id.
        const setPart = sql.slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE'))
        const cols = setPart.split(',').map((s) => s.trim().split(' ')[0])
        const id = params[params.length - 1]
        const row = pursuits.get(String(id))
        if (row) cols.forEach((c, i) => { row[c] = params[i] })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db }
}

describe('storage/pursuits CRUD', () => {
  beforeEach(() => {
    mockUuidCounter = 0
  })

  it('creates a pursuit with active defaults and reads it back', async () => {
    const { db } = createFakeDb()
    const created = await createPursuit({ title: 'Marathon training' }, db)
    expect(created.success).toBe(true)
    if (!created.success) return

    expect(created.data.status).toBe('active')
    expect(created.data.details).toBe('')
    expect(created.data.checkin_question).toBe('')
    expect(created.data.wiki_page_id).toBeNull()
    expect(created.data.last_checkin_at).toBeNull()
    expect(created.data.last_mentioned_at).toBe(created.data.created_at)

    const got = await getPursuit(created.data.id, db)
    expect(got.success && got.data?.title).toBe('Marathon training')

    const missing = await getPursuit('nope', db)
    expect(missing.success && missing.data).toBeNull()
  })

  it('lists pursuits most-recently-mentioned first', async () => {
    const { db } = createFakeDb()
    const a = await createPursuit({ title: 'A' }, db)
    const b = await createPursuit({ title: 'B' }, db)
    if (!a.success || !b.success) throw new Error('setup failed')

    await updatePursuit(a.data.id, { last_mentioned_at: 1000 }, db)
    await updatePursuit(b.data.id, { last_mentioned_at: 2000 }, db)

    const list = await listPursuits(db)
    expect(list.success).toBe(true)
    if (list.success) expect(list.data.map((p) => p.title)).toEqual(['B', 'A'])
  })

  it('patches only the supplied fields', async () => {
    const { db } = createFakeDb()
    const created = await createPursuit({ title: 'Fix sleep' }, db)
    if (!created.success) throw new Error('setup failed')

    const updated = await updatePursuit(
      created.data.id,
      { status: 'done', last_checkin_at: 5000, checkin_question: 'How did it go?' },
      db
    )
    expect(updated.success).toBe(true)
    if (updated.success) {
      expect(updated.data.status).toBe('done')
      expect(updated.data.last_checkin_at).toBe(5000)
      expect(updated.data.checkin_question).toBe('How did it go?')
      // untouched fields keep their values
      expect(updated.data.title).toBe('Fix sleep')
      expect(updated.data.details).toBe('')
    }
  })

  it('returns PURSUIT_NOT_FOUND when updating a missing row', async () => {
    const { db } = createFakeDb()
    const res = await updatePursuit('ghost', { status: 'dormant' }, db)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('PURSUIT_NOT_FOUND')
  })
})
