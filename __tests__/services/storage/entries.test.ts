import { type SqliteDatabase } from '@/services/storage/db'
import {
  createEntry,
  getEntry,
  listEntries,
  applyTags,
  deleteEntry,
} from '@/services/storage/entries'

let mockUuidCounter = 0
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockUuidCounter}`,
}))

// In-memory fake backing the exact queries entries.ts issues, so we can assert
// real round-trip semantics (create -> read -> update -> delete).
function createFakeDb() {
  const rows = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^INSERT INTO entries/.test(sql)) {
        const [id, created_at, mood, situation, thought, behavior, closing_note] = params
        rows.set(String(id), {
          id,
          created_at,
          mood,
          situation,
          thought,
          behavior,
          closing_note,
          emotion: null,
          distortion: null,
          mood_score: null,
          tagged_at: null,
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM entries WHERE id/.test(sql)) {
        const row = rows.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entries ORDER BY created_at DESC/.test(sql)) {
        const limit = Number(params[0])
        const all = [...rows.values()].sort(
          (a, b) => Number(b.created_at) - Number(a.created_at)
        )
        return { rows: all.slice(0, limit), rowsAffected: 0 }
      }
      if (/^UPDATE entries SET/.test(sql)) {
        const [emotion, distortion, mood_score, topic, tagged_at, id] = params
        const row = rows.get(String(id))
        if (row) Object.assign(row, { emotion, distortion, mood_score, topic, tagged_at })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^DELETE FROM entries WHERE id/.test(sql)) {
        const existed = rows.delete(String(params[0]))
        return { rows: [], rowsAffected: existed ? 1 : 0 }
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

describe('storage/entries CRUD', () => {
  beforeEach(() => {
    mockUuidCounter = 0
  })

  it('creates an entry with generated id, timestamp, and null tags', async () => {
    const { db } = createFakeDb()
    const result = await createEntry(
      { mood: 3, situation: 'meeting', thought: 'I will fail' },
      db
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('uuid-1')
      expect(result.data.mood).toBe(3)
      expect(result.data.behavior).toBeNull()
      expect(result.data.emotion).toBeNull()
      expect(typeof result.data.created_at).toBe('number')
    }
  })

  it('reads a created entry back; returns null for a missing id', async () => {
    const { db } = createFakeDb()
    const created = await createEntry({ mood: 4, situation: 's', thought: 't' }, db)
    const id = created.success ? created.data.id : ''

    const found = await getEntry(id, db)
    expect(found.success && found.data?.situation).toBe('s')

    const missing = await getEntry('nope', db)
    expect(missing.success && missing.data).toBeNull()
  })

  it('lists entries newest-first', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 1, situation: 'first', thought: 't' }, db)
    await new Promise((r) => setTimeout(r, 2))
    await createEntry({ mood: 5, situation: 'second', thought: 't' }, db)

    const result = await listEntries(10, db)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(2)
      expect(result.data[0].situation).toBe('second')
    }
  })

  it('applies fast-model tags to an existing entry', async () => {
    const { db } = createFakeDb()
    const created = await createEntry({ mood: 2, situation: 's', thought: 't' }, db)
    const id = created.success ? created.data.id : ''

    const tagged = await applyTags(id, { emotion: 'anxiety', distortion: 'catastrophizing', mood_score: 0.3, topic: 'Work' }, db)
    expect(tagged.success).toBe(true)

    const found = await getEntry(id, db)
    expect(found.success && found.data?.emotion).toBe('anxiety')
    expect(found.success && found.data?.tagged_at).not.toBeNull()
  })

  it('deletes an entry', async () => {
    const { db } = createFakeDb()
    const created = await createEntry({ mood: 3, situation: 's', thought: 't' }, db)
    const id = created.success ? created.data.id : ''

    await deleteEntry(id, db)
    const found = await getEntry(id, db)
    expect(found.success && found.data).toBeNull()
  })

  it('returns an ENTRY_CREATE_FAILED error when the db throws', async () => {
    const failing: SqliteDatabase = {
      async execute() {
        throw new Error('disk full')
      },
      async transaction() {},
      close() {},
    }
    const result = await createEntry({ mood: 3, situation: 's', thought: 't' }, failing)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('ENTRY_CREATE_FAILED')
  })
})
