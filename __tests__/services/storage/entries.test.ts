import { type SqliteDatabase } from '@/services/storage/db'
import {
  createEntry,
  getEntry,
  listEntries,
  applyTags,
  deleteEntry,
  listEntriesByEmotion,
  listEntriesByTopic,
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
        const [id, created_at, mood, situation, thought, behavior, closing_note, named_emotion, energy, source] = params
        rows.set(String(id), {
          id,
          created_at,
          mood,
          situation,
          thought,
          behavior,
          closing_note,
          emotion: null,
          named_emotion: named_emotion ?? null,
          energy: energy ?? null,
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
      const byTag = /^SELECT \* FROM entries WHERE (emotion|distortion|topic) = \? COLLATE NOCASE AND source = 'journal' ORDER BY created_at DESC/.exec(
        sql
      )
      if (byTag) {
        const col = byTag[1]
        const value = String(params[0]).toLowerCase()
        const all = [...rows.values()]
          .filter((r) => r.source === 'journal' && String(r[col] ?? '').toLowerCase() === value)
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        return { rows: all, rowsAffected: 0 }
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

  it('lists entries behind an emotion node, newest first, journal-only', async () => {
    const { db, rows } = createFakeDb()
    const a = await createEntry({ mood: 2, situation: 'older', thought: 't' }, db)
    const b = await createEntry({ mood: 2, situation: 'newer', thought: 't' }, db)
    const reflect = await createEntry(
      { mood: 2, situation: 'chat', thought: '', source: 'reflect' },
      db
    )
    // Pin created_at so ordering is deterministic (createEntry uses Date.now()).
    if (a.success) rows.get(a.data.id)!.created_at = 100
    if (b.success) rows.get(b.data.id)!.created_at = 200
    const tag = { distortion: 'none', mood_score: 0.2, topic: 'work' }
    if (a.success) await applyTags(a.data.id, { emotion: 'Anxiety', ...tag }, db)
    if (b.success) await applyTags(b.data.id, { emotion: 'anxiety', ...tag }, db)
    if (reflect.success) await applyTags(reflect.data.id, { emotion: 'anxiety', ...tag }, db)

    const res = await listEntriesByEmotion('anxiety', db) // case-insensitive
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.map((e) => e.situation)).toEqual(['newer', 'older']) // reflect excluded, newest first
    }
  })

  it('lists entries behind a topic node', async () => {
    const { db } = createFakeDb()
    const e = await createEntry({ mood: 3, situation: 'standup', thought: 't' }, db)
    if (e.success) {
      await applyTags(e.data.id, { emotion: 'calm', distortion: 'none', mood_score: 0.6, topic: 'Work' }, db)
    }
    const res = await listEntriesByTopic('work', db)
    expect(res.success && res.data).toHaveLength(1)
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

  it('stores the energy axis from the capture grid', async () => {
    const { db } = createFakeDb()
    const created = await createEntry({ mood: 4, situation: 's', thought: 't', named_emotion: 'Hopeful', energy: 5 }, db)
    expect(created.success && created.data.energy).toBe(5)
    const id = created.success ? created.data.id : ''
    const found = await getEntry(id, db)
    expect(found.success && found.data?.energy).toBe(5)
    expect(found.success && found.data?.mood).toBe(4) // pleasantness axis unchanged
  })

  it('keeps the user-named feeling and the model-inferred emotion side by side', async () => {
    const { db } = createFakeDb()
    const created = await createEntry({ mood: 4, situation: 's', thought: 't', named_emotion: 'Hopeful' }, db)
    expect(created.success && created.data.named_emotion).toBe('Hopeful')
    expect(created.success && created.data.emotion).toBeNull() // model hasn't run yet
    const id = created.success ? created.data.id : ''

    // The model infers 'anxiety' — stored in `emotion`, leaving the named feeling intact.
    await applyTags(id, { emotion: 'anxiety', distortion: 'none', mood_score: 0.6, topic: 'Work' }, db)
    const found = await getEntry(id, db)
    expect(found.success && found.data?.named_emotion).toBe('Hopeful') // user's, untouched
    expect(found.success && found.data?.emotion).toBe('anxiety') // model's, the graph signal
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
