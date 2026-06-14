import { type SqliteDatabase } from '@/services/storage/db'
import {
  createPage,
  deleteEmptyPages,
  dismissPage,
  getPage,
  getPageByTitle,
  listDismissedPages,
  listPages,
  restorePage,
  updatePage,
} from '@/services/storage/wiki'

let mockUuidCounter = 0
jest.mock('expo-crypto', () => ({
  randomUUID: () => `page-${++mockUuidCounter}`,
}))

// In-memory fake backing the queries wiki.ts issues.
function createFakeDb() {
  const rows = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^INSERT INTO wiki_pages/.test(sql)) {
        const [id, title, category, content, entry_count, version, version_history, created_at, updated_at] =
          params
        rows.set(String(id), {
          id,
          title,
          category,
          content,
          entry_count,
          version,
          version_history,
          created_at,
          updated_at,
          dismissed_at: null,
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM wiki_pages WHERE id/.test(sql)) {
        const row = rows.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM wiki_pages WHERE title/.test(sql)) {
        const row = [...rows.values()].find((r) => r.title === params[0])
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM wiki_pages WHERE dismissed_at IS NOT NULL/.test(sql)) {
        const out = [...rows.values()]
          .filter((r) => r.dismissed_at != null)
          .sort((a, b) => Number(b.dismissed_at) - Number(a.dismissed_at))
        return { rows: out, rowsAffected: 0 }
      }
      if (/^SELECT \* FROM wiki_pages WHERE dismissed_at IS NULL/.test(sql)) {
        const out = [...rows.values()]
          .filter((r) => r.dismissed_at == null)
          .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
        return { rows: out, rowsAffected: 0 }
      }
      if (/^UPDATE wiki_pages SET dismissed_at = \? WHERE id/.test(sql)) {
        const row = rows.get(String(params[1]))
        if (row) row.dismissed_at = params[0]
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE wiki_pages SET dismissed_at = NULL WHERE id/.test(sql)) {
        const row = rows.get(String(params[0]))
        if (row) row.dismissed_at = null
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE wiki_pages/.test(sql)) {
        const [content, version, version_history, entry_count, updated_at, id] = params
        const row = rows.get(String(id))
        if (row) {
          Object.assign(row, { content, version, version_history, entry_count, updated_at, dismissed_at: null })
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^DELETE FROM wiki_pages/.test(sql)) {
        let removed = 0
        for (const [id, r] of [...rows.entries()]) {
          if (Number(r.entry_count) === 0 && String(r.content) === '') {
            rows.delete(id)
            removed++
          }
        }
        return { rows: [], rowsAffected: removed }
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

describe('storage/wiki CRUD', () => {
  beforeEach(() => {
    mockUuidCounter = 0
  })

  it('creates a page at version 1 with empty history', async () => {
    const { db } = createFakeDb()
    const result = await createPage({ title: 'Public speaking', category: 'situation' }, db)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe('Public speaking')
      expect(result.data.version).toBe(1)
      expect(result.data.entry_count).toBe(0)
      expect(result.data.version_history).toEqual([])
    }
  })

  it('finds a page by title and returns null when absent', async () => {
    const { db } = createFakeDb()
    await createPage({ title: 'Self-doubt' }, db)
    const found = await getPageByTitle('Self-doubt', db)
    expect(found.success && found.data?.title).toBe('Self-doubt')
    const missing = await getPageByTitle('nope', db)
    expect(missing.success && missing.data).toBeNull()
  })

  it('updatePage archives the old content, bumps version, increments entry_count', async () => {
    const { db } = createFakeDb()
    const created = await createPage({ title: 'Work stress', content: 'v1 text' }, db)
    const id = created.success ? created.data.id : ''

    const updated = await updatePage(id, 'v2 text', db)
    expect(updated.success).toBe(true)
    if (updated.success) {
      expect(updated.data.content).toBe('v2 text')
      expect(updated.data.version).toBe(2)
      expect(updated.data.entry_count).toBe(1)
      expect(updated.data.version_history).toHaveLength(1)
      expect(updated.data.version_history[0].content).toBe('v1 text')
    }

    // persisted history survives a re-read
    const reread = await getPage(id, db)
    expect(reread.success && reread.data?.version).toBe(2)
    expect(reread.success && reread.data?.version_history[0].content).toBe('v1 text')
  })

  it('updatePage returns WIKI_NOT_FOUND for a missing id', async () => {
    const { db } = createFakeDb()
    const result = await updatePage('missing', 'x', db)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('WIKI_NOT_FOUND')
  })

  it('lists pages', async () => {
    const { db } = createFakeDb()
    await createPage({ title: 'A' }, db)
    await createPage({ title: 'B' }, db)
    const result = await listPages(db)
    expect(result.success && result.data).toHaveLength(2)
  })

  it('deleteEmptyPages removes blank 0-entry shells but keeps synthesized pages', async () => {
    const { db } = createFakeDb()
    const real = await createPage({ title: 'Anxiety', category: 'emotion' }, db)
    if (real.success) await updatePage(real.data.id, 'real content', db) // now has content + 1 entry
    await createPage({ title: 'Empty', category: 'theme' }, db) // blank shell, never synthesized

    const removed = await deleteEmptyPages(db)
    expect(removed.success && removed.data).toBe(1)

    const pages = await listPages(db)
    expect(pages.success && pages.data.map((p) => p.title)).toEqual(['Anxiety'])
  })

  it('a dismissed page drops out of listPages and into listDismissedPages', async () => {
    const { db } = createFakeDb()
    const a = await createPage({ title: 'A' }, db)
    await createPage({ title: 'B' }, db)
    if (!a.success) throw new Error('setup failed')

    const dismissed = await dismissPage(a.data.id, db)
    expect(dismissed.success).toBe(true)

    const active = await listPages(db)
    expect(active.success && active.data.map((p) => p.title)).toEqual(['B'])

    const dropped = await listDismissedPages(db)
    expect(dropped.success && dropped.data.map((p) => p.title)).toEqual(['A'])

    const got = await getPage(a.data.id, db)
    expect(got.success && got.data?.dismissed_at).toEqual(expect.any(Number))
  })

  it('restorePage brings a dropped page back into listPages', async () => {
    const { db } = createFakeDb()
    const a = await createPage({ title: 'A' }, db)
    if (!a.success) throw new Error('setup failed')
    await dismissPage(a.data.id, db)

    const restored = await restorePage(a.data.id, db)
    expect(restored.success).toBe(true)

    const active = await listPages(db)
    expect(active.success && active.data.map((p) => p.title)).toEqual(['A'])
    const got = await getPage(a.data.id, db)
    expect(got.success && got.data?.dismissed_at).toBeNull()
  })

  it('re-synthesizing a dropped page clears the dismissal (self-heal)', async () => {
    const { db } = createFakeDb()
    const a = await createPage({ title: 'Anxiety', category: 'emotion' }, db)
    if (!a.success) throw new Error('setup failed')
    await dismissPage(a.data.id, db)

    await updatePage(a.data.id, 'fresh content', db)
    const got = await getPage(a.data.id, db)
    expect(got.success && got.data?.dismissed_at).toBeNull()
    expect(got.success && got.data?.content).toBe('fresh content')
  })

  it('dismiss/restore return WIKI_NOT_FOUND for a missing id', async () => {
    const { db } = createFakeDb()
    const d = await dismissPage('ghost', db)
    expect(d.success).toBe(false)
    if (!d.success) expect(d.error.code).toBe('WIKI_NOT_FOUND')
    const r = await restorePage('ghost', db)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.code).toBe('WIKI_NOT_FOUND')
  })
})
