import { type SqliteDatabase } from '@/services/storage/db'
import {
  createEntry,
  getEntry,
  listEntries,
  listStreakTimestamps,
  listEntriesForGraphPage,
  listUnindexedEntries,
  listWikiPendingEntries,
  markWikiIndexed,
  listGraphPendingEntries,
  markGraphIndexed,
  markAllGraphIndexed,
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
        const [id, created_at, updated_at, mood, situation, thought, behavior, closing_note, named_emotion, energy, raw_text, source] = params
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
          wiki_indexed_at: null,
          graph_indexed_at: null,
          raw_text: raw_text ?? null,
          source,
          updated_at,
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
      if (/^SELECT \* FROM entries WHERE 1 = 1/.test(sql)) {
        const hasCursor = /created_at < \?/.test(sql)
        const limit = Number(params[hasCursor ? 3 : 0])
        const cursorCreatedAt = hasCursor ? Number(params[0]) : null
        const cursorId = hasCursor ? String(params[2]) : null
        const all = [...rows.values()]
          .filter((r) => !hasCursor || Number(r.created_at) < cursorCreatedAt! || (Number(r.created_at) === cursorCreatedAt && String(r.id) < cursorId!))
          .sort((a, b) => Number(b.created_at) - Number(a.created_at) || String(b.id).localeCompare(String(a.id)))
        return { rows: all.slice(0, limit), rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entries WHERE tagged_at IS NULL AND \(TRIM\(situation\) <> '' OR TRIM\(thought\) <> ''\) ORDER BY created_at ASC/.test(sql)) {
        const limit = Number(params[0])
        const all = [...rows.values()]
          .filter(
            (r) =>
              r.tagged_at == null &&
              (String(r.situation ?? '').trim() !== '' || String(r.thought ?? '').trim() !== '')
          )
          .sort((a, b) => Number(a.created_at) - Number(b.created_at))
        return { rows: all.slice(0, limit), rowsAffected: 0 }
      }
      if (/^SELECT created_at FROM entries WHERE source IN \('journal', 'path'\) ORDER BY created_at DESC/.test(sql)) {
        const limit = Number(params[0])
        const all = [...rows.values()]
          .filter((r) => r.source === 'journal' || r.source === 'path')
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        return { rows: all.slice(0, limit).map((r) => ({ created_at: r.created_at })), rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entries WHERE tagged_at IS NOT NULL AND wiki_indexed_at IS NULL AND \(TRIM\(situation\) <> '' OR TRIM\(thought\) <> ''\) ORDER BY created_at ASC/.test(sql)) {
        const limit = Number(params[0])
        const all = [...rows.values()]
          .filter(
            (r) =>
              r.tagged_at != null &&
              r.wiki_indexed_at == null &&
              (String(r.situation ?? '').trim() !== '' || String(r.thought ?? '').trim() !== '')
          )
          .sort((a, b) => Number(a.created_at) - Number(b.created_at))
        return { rows: all.slice(0, limit), rowsAffected: 0 }
      }
      if (/^SELECT \* FROM entries WHERE tagged_at IS NOT NULL AND graph_indexed_at IS NULL AND \(TRIM\(situation\) <> '' OR TRIM\(thought\) <> ''\) ORDER BY created_at ASC/.test(sql)) {
        const limit = Number(params[0])
        const all = [...rows.values()]
          .filter(
            (r) =>
              r.tagged_at != null &&
              r.graph_indexed_at == null &&
              (String(r.situation ?? '').trim() !== '' || String(r.thought ?? '').trim() !== '')
          )
          .sort((a, b) => Number(a.created_at) - Number(b.created_at))
        return { rows: all.slice(0, limit), rowsAffected: 0 }
      }
      // Specific indexed-marker stamps — must precede the generic tag UPDATE below.
      if (/^UPDATE entries SET wiki_indexed_at = \? WHERE id/.test(sql)) {
        const [wiki_indexed_at, id] = params
        const row = rows.get(String(id))
        if (row) Object.assign(row, { wiki_indexed_at })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE entries SET graph_indexed_at = \? WHERE id/.test(sql)) {
        const [graph_indexed_at, id] = params
        const row = rows.get(String(id))
        if (row) Object.assign(row, { graph_indexed_at })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE entries SET graph_indexed_at = \? WHERE tagged_at IS NOT NULL AND graph_indexed_at IS NULL/.test(sql)) {
        const [graph_indexed_at] = params
        let affected = 0
        for (const row of rows.values()) {
          if (row.tagged_at != null && row.graph_indexed_at == null) {
            row.graph_indexed_at = graph_indexed_at
            affected++
          }
        }
        return { rows: [], rowsAffected: affected }
      }
      if (/^UPDATE entries SET emotion/.test(sql)) {
        const [emotion, distortion, mood_score, topic, topic2, tagged_at, updated_at, id] = params
        const row = rows.get(String(id))
        if (row) Object.assign(row, {
          emotion, distortion, mood_score, topic, topic2, tagged_at,
          updated_at: Math.max(Number(row.updated_at ?? 0) + 1, Number(updated_at)),
        })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^INSERT INTO sync_queue/.test(sql)) {
        return { rows: [], rowsAffected: 1 }
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

  it('keeps tag watermarks strictly newer than the existing row', async () => {
    const { db, rows } = createFakeDb()
    const created = await createEntry(
      { mood: 3, situation: 'meeting', thought: 'I will fail' },
      db
    )
    expect(created.success).toBe(true)
    const row = rows.get('uuid-1')!
    row.updated_at = 10_000
    const now = Date.now
    Date.now = () => 1
    try {
      const tagged = await applyTags('uuid-1', {
        emotion: 'anxiety', distortion: 'none', mood_score: 3, topic: 'Work', topic2: '',
      }, db)
      expect(tagged.success).toBe(true)
      expect(row.updated_at).toBe(10_001)
    } finally {
      Date.now = now
    }
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

  it('streak timestamps include journal AND path answers, but not reflect', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 3, situation: 'journaled', thought: 't' }, db)
    await createEntry({ mood: 3, situation: 'a guided answer', thought: '', source: 'path' }, db)
    await createEntry({ mood: 3, situation: 'said in chat', thought: '', source: 'reflect' }, db)

    const result = await listStreakTimestamps(400, db)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toHaveLength(2) // journal + path, reflect excluded
  })

  it('lists graph entries across all sources through bounded pages', async () => {
    const { db } = createFakeDb()
    await createEntry({ mood: 3, situation: 'journaled', thought: 't' }, db)
    await createEntry({ mood: 3, situation: 'guided answer', thought: '', source: 'path' }, db)
    await createEntry({ mood: 3, situation: 'said in chat', thought: '', source: 'reflect' }, db)

    const result = await listEntriesForGraphPage({ limit: 50 }, db)
    expect(result.success).toBe(true)
    // Unlike listEntries (journal-only), the graph must re-derive from every
    // source so path/reflect signal survives a rebuild.
    if (result.success) expect(result.data.items).toHaveLength(3)
  })

  it('paginates graph entries with a stable created_at/id keyset', async () => {
    const { db, rows } = createFakeDb()
    rows.set('a', { id: 'a', created_at: 100, mood: 3, situation: 'a', thought: '', source: 'journal' })
    rows.set('b', { id: 'b', created_at: 100, mood: 3, situation: 'b', thought: '', source: 'journal' })
    rows.set('c', { id: 'c', created_at: 99, mood: 3, situation: 'c', thought: '', source: 'journal' })

    const first = await listEntriesForGraphPage({ limit: 2 }, db)
    expect(first.success).toBe(true)
    expect(first.success && first.data.items.map((item) => item.id)).toEqual(['b', 'a'])
    expect(first.success && first.data.nextCursor).toEqual({ createdAt: 100, id: 'a' })

    const second = await listEntriesForGraphPage({ limit: 2, cursor: first.success ? first.data.nextCursor : null }, db)
    expect(second.success).toBe(true)
    expect(second.success && second.data.items.map((item) => item.id)).toEqual(['c'])
    expect(second.success && second.data.nextCursor).toBeNull()
  })

  it('traverses more than 10,000 graph entries without omissions', async () => {
    const { db, rows } = createFakeDb()
    for (let i = 0; i < 10001; i++) {
      rows.set(`entry-${i}`, {
        id: `entry-${i}`,
        created_at: 10001 - i,
        mood: 3,
        situation: `situation-${i}`,
        thought: '',
        source: 'journal',
      })
    }

    const ids: string[] = []
    let cursor: { createdAt: number; id: string } | null = null
    do {
      const page = await listEntriesForGraphPage({ limit: 500, cursor }, db)
      expect(page.success).toBe(true)
      if (!page.success) break
      ids.push(...page.data.items.map((item) => item.id))
      cursor = page.data.nextCursor
    } while (cursor)

    expect(ids).toHaveLength(10001)
    expect(new Set(ids).size).toBe(10001)
    expect(ids[0]).toBe('entry-0')
    expect(ids.at(-1)).toBe('entry-10000')
  })

  it('lists only un-indexed entries with text — tagged ones and empty mood-logs excluded', async () => {
    const { db } = createFakeDb()
    const withText = await createEntry({ mood: 3, situation: 'a real reflection', thought: '' }, db)
    await createEntry({ mood: 3, situation: '', thought: '' }, db) // quick mood-log, no text
    const tagged = await createEntry({ mood: 3, situation: 'already indexed', thought: '' }, db)
    if (tagged.success) {
      await applyTags(tagged.data.id, { emotion: 'Joy', distortion: 'none', mood_score: 0.8, topic: 'X', topic2: '' }, db)
    }

    const result = await listUnindexedEntries(50, db)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe(withText.success && withText.data.id)
    }
  })

  it('lists wiki-pending entries: tagged but not yet wiki-indexed, with text', async () => {
    const { db } = createFakeDb()
    // tagged + wiki-pending → included
    const pending = await createEntry({ mood: 3, situation: 'tagged, wiki interrupted', thought: '' }, db)
    if (pending.success) {
      await applyTags(pending.data.id, { emotion: 'Joy', distortion: 'none', mood_score: 0.8, topic: 'X', topic2: '' }, db)
    }
    // tagged + wiki-indexed → excluded
    const done = await createEntry({ mood: 3, situation: 'fully indexed', thought: '' }, db)
    if (done.success) {
      await applyTags(done.data.id, { emotion: 'Joy', distortion: 'none', mood_score: 0.8, topic: 'X', topic2: '' }, db)
      await markWikiIndexed(done.data.id, db)
    }
    // never tagged → excluded (that's listUnindexedEntries' job, not this one)
    await createEntry({ mood: 3, situation: 'untagged', thought: '' }, db)

    const result = await listWikiPendingEntries(50, db)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe(pending.success && pending.data.id)
    }
  })

  it('markWikiIndexed stamps wiki_indexed_at so the entry drops out of the pending list', async () => {
    const { db } = createFakeDb()
    const e = await createEntry({ mood: 3, situation: 'tagged', thought: '' }, db)
    if (!e.success) throw new Error('setup')
    await applyTags(e.data.id, { emotion: 'Joy', distortion: 'none', mood_score: 0.8, topic: 'X', topic2: '' }, db)

    const before = await listWikiPendingEntries(50, db)
    expect(before.success && before.data).toHaveLength(1)

    await markWikiIndexed(e.data.id, db)

    const after = await listWikiPendingEntries(50, db)
    expect(after.success && after.data).toHaveLength(0)

    const row = await getEntry(e.data.id, db)
    expect(row.success && row.data?.wiki_indexed_at).toEqual(expect.any(Number))
  })

  it('lists graph-pending entries: tagged but not yet graph-indexed, with text', async () => {
    const { db } = createFakeDb()
    const pending = await createEntry({ mood: 3, situation: 'tagged, graph interrupted', thought: '' }, db)
    if (pending.success) {
      await applyTags(pending.data.id, { emotion: 'Joy', distortion: 'none', mood_score: 0.8, topic: 'X', topic2: '' }, db)
    }
    const done = await createEntry({ mood: 3, situation: 'graph landed', thought: '' }, db)
    if (done.success) {
      await applyTags(done.data.id, { emotion: 'Joy', distortion: 'none', mood_score: 0.8, topic: 'X', topic2: '' }, db)
      await markGraphIndexed(done.data.id, db)
    }
    await createEntry({ mood: 3, situation: 'untagged', thought: '' }, db) // excluded

    const result = await listGraphPendingEntries(50, db)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe(pending.success && pending.data.id)
    }
  })

  it('markAllGraphIndexed clears the whole graph-pending backlog (tagged rows only)', async () => {
    const { db } = createFakeDb()
    const a = await createEntry({ mood: 3, situation: 'first', thought: '' }, db)
    const b = await createEntry({ mood: 3, situation: 'second', thought: '' }, db)
    const tag = { emotion: 'Joy', distortion: 'none', mood_score: 0.8, topic: 'X', topic2: '' }
    if (a.success) await applyTags(a.data.id, tag, db)
    if (b.success) await applyTags(b.data.id, tag, db)
    await createEntry({ mood: 3, situation: 'untagged', thought: '' }, db) // stays pending-ineligible

    const before = await listGraphPendingEntries(50, db)
    expect(before.success && before.data).toHaveLength(2)

    await markAllGraphIndexed(db)

    const after = await listGraphPendingEntries(50, db)
    expect(after.success && after.data).toHaveLength(0)
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
    const tag = { distortion: 'none', mood_score: 0.2, topic: 'work', topic2: '' }
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
      await applyTags(e.data.id, { emotion: 'calm', distortion: 'none', mood_score: 0.6, topic: 'Work', topic2: '' }, db)
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

    const tagged = await applyTags(id, { emotion: 'anxiety', distortion: 'catastrophizing', mood_score: 0.3, topic: 'Work', topic2: '' }, db)
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
    await applyTags(id, { emotion: 'anxiety', distortion: 'none', mood_score: 0.6, topic: 'Work', topic2: '' }, db)
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
      async transaction(fn) {
        await fn(this)
      },
      close() {},
    }
    const result = await createEntry({ mood: 3, situation: 's', thought: 't' }, failing)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('ENTRY_CREATE_FAILED')
  })
})
