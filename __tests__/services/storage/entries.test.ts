import { type SqliteDatabase } from '@/services/storage/db'
import {
  createEntry,
  getEntry,
  listEntries,
  searchEntries,
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
        const [id, created_at, mood, situation, thought, behavior, closing_note, source] = params
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
          source,
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM entries WHERE id/.test(sql)) {
        const row = rows.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entries WHERE source = 'journal' ORDER BY created_at DESC/.test(sql)) {
        const limit = Number(params[0])
        const all = [...rows.values()]
          .filter((r) => r.source === 'journal')
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
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
      if (/^SELECT \* FROM entries\s+WHERE source = 'journal'\s+AND \(situation LIKE/.test(sql)) {
        const raw = String(params[0]) // %term%
        const term = raw.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase()
        const limit = Number(params[4])
        const fields = ['situation', 'thought', 'behavior', 'closing_note']
        const all = [...rows.values()]
          .filter((r) => r.source === 'journal')
          .filter((r) => fields.some((c) => String(r[c] ?? '').toLowerCase().includes(term)))
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        return { rows: all.slice(0, limit), rowsAffected: 0 }
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
      expect(result.data.source).toBe('journal') // default
      expect(typeof result.data.created_at).toBe('number')
    }
  })

  it("creates a 'reflect'-sourced entry when asked", async () => {
    const { db } = createFakeDb()
    const result = await createEntry(
      { mood: 3, situation: 'my sister called', thought: '', source: 'reflect' },
      db
    )
    expect(result.success && result.data.source).toBe('reflect')
  })

  it('lists only journal entries — chat-derived (reflect) entries are excluded', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 3, situation: 'journaled', thought: 't' }, db)
    await createEntry(
      { mood: 3, situation: 'said in chat', thought: '', source: 'reflect' },
      db
    )

    const result = await listEntries(10, db)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(1)
      expect(result.data[0].situation).toBe('journaled')
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

describe('searchEntries', () => {
  it('matches across situation/thought/closing fields, newest first', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 3, situation: 'lunch with Mom', thought: 'felt warm' }, db)
    await new Promise((r) => setTimeout(r, 2))
    await createEntry({ mood: 2, situation: 'work', thought: 'mom would be proud' }, db)
    await createEntry({ mood: 4, situation: 'gym', thought: 'good session' }, db)

    const res = await searchEntries('mom', 10, db)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.map((e) => e.situation)).toEqual(['work', 'lunch with Mom']) // newest first, case-insensitive
  })

  it('excludes reflect-sourced entries', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 3, situation: 'private journal note', thought: 't' }, db)
    await createEntry({ mood: 3, situation: 'note said in chat', thought: '', source: 'reflect' }, db)

    const res = await searchEntries('note', 10, db)
    expect(res.success && res.data).toHaveLength(1)
    expect(res.success && res.data[0].situation).toBe('private journal note')
  })

  it('returns nothing for a blank query (no db hit)', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 3, situation: 'something', thought: 't' }, db)
    const res = await searchEntries('   ', 10, db)
    expect(res.success && res.data).toEqual([])
  })

  it('treats % and _ as literals, not wildcards', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 3, situation: 'up 50% today', thought: 't' }, db)
    await createEntry({ mood: 3, situation: 'plain entry', thought: 't' }, db)

    const hit = await searchEntries('50%', 10, db)
    expect(hit.success && hit.data).toHaveLength(1)
    const wildcard = await searchEntries('%', 10, db) // would match all if not escaped
    expect(wildcard.success && wildcard.data).toHaveLength(1)
  })
})
