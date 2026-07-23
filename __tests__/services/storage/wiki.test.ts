import { type SqliteDatabase } from '@/services/storage/db'
import {
  capVersionHistory,
  correctPage,
  createPage,
  deleteEmptyPages,
  dismissPage,
  getPage,
  getPageByTitle,
  listDismissedPages,
  listPages,
  regeneratePageContent,
  restorePage,
  updatePage,
  type WikiPageVersion,
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
          corrected_at: null,
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
      if (/^UPDATE wiki_pages SET dismissed_at = \?, updated_at = MAX/.test(sql)) {
        const row = rows.get(String(params[2]))
        if (row) {
          row.dismissed_at = params[0]
          row.updated_at = Math.max(Number(row.updated_at ?? 0) + 1, Number(params[1]))
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE wiki_pages SET dismissed_at = NULL, updated_at = MAX/.test(sql)) {
        const row = rows.get(String(params[1]))
        if (row) {
          row.dismissed_at = null
          row.updated_at = Math.max(Number(row.updated_at ?? 0) + 1, Number(params[0]))
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE wiki_pages\s+SET content = \?, version = \?, version_history = \?, updated_at = \?,\s+corrected_at = \?/.test(sql)) {
        const [content, version, version_history, updated_at, corrected_at, id] = params
        const row = rows.get(String(id))
        if (row) {
          Object.assign(row, { content, version, version_history, updated_at, corrected_at, dismissed_at: null })
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE wiki_pages\s+SET content = \?, version = \?, version_history = \?, updated_at = \?, corrected_at = NULL/.test(sql)) {
        // regeneratePageContent: no entry_count change, dismissed_at untouched
        const [content, version, version_history, updated_at, id] = params
        const row = rows.get(String(id))
        if (row) Object.assign(row, { content, version, version_history, updated_at, corrected_at: null })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE wiki_pages/.test(sql)) {
        const [content, version, version_history, entry_count, updated_at, id] = params
        const row = rows.get(String(id))
        if (row) {
          Object.assign(row, {
            content,
            version,
            version_history,
            entry_count,
            updated_at,
            dismissed_at: null,
            corrected_at: null,
          })
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

  it('keeps page modification watermarks monotonic when the clock goes backward', async () => {
    const { db } = createFakeDb()
    const created = await createPage({ title: 'Work', category: 'theme', content: 'first' }, db)
    expect(created.success).toBe(true)
    if (!created.success) return

    const originalNow = Date.now
    Date.now = () => created.data.updated_at - 1000
    try {
      const updated = await updatePage(created.data.id, 'second', db)
      expect(updated.success).toBe(true)
      if (updated.success) expect(updated.data.updated_at).toBe(created.data.updated_at + 1)
    } finally {
      Date.now = originalNow
    }
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

  it('correctPage replaces content with the user’s words, marks it, and un-drops', async () => {
    const { db } = createFakeDb()
    const created = await createPage({ title: 'Avoidant', content: 'AI said you avoid people' }, db)
    const id = created.success ? created.data.id : ''
    await dismissPage(id, db) // user dropped it first

    const corrected = await correctPage(id, 'I just value alone time', db)
    expect(corrected.success).toBe(true)
    if (corrected.success) {
      expect(corrected.data.content).toBe('I just value alone time')
      expect(corrected.data.version).toBe(2)
      expect(corrected.data.corrected_at).toEqual(expect.any(Number))
      expect(corrected.data.dismissed_at).toBeNull() // correcting un-drops
      expect(corrected.data.entry_count).toBe(0) // a correction is not an entry
      expect(corrected.data.version_history[0].content).toBe('AI said you avoid people')
    }

    // a corrected page is active again — back in listPages with the user's text
    const active = await listPages(db)
    expect(active.success && active.data.map((p) => p.content)).toEqual(['I just value alone time'])
  })

  it('a later synthesis supersedes a correction (clears corrected_at)', async () => {
    const { db } = createFakeDb()
    const created = await createPage({ title: 'Avoidant', content: 'old' }, db)
    const id = created.success ? created.data.id : ''
    await correctPage(id, 'my words', db)

    await updatePage(id, 'AI rebuilt on my words', db)
    const got = await getPage(id, db)
    expect(got.success && got.data?.corrected_at).toBeNull()
    expect(got.success && got.data?.content).toBe('AI rebuilt on my words')
  })

  it('regeneratePageContent archives + bumps version but does NOT change entry_count', async () => {
    const { db } = createFakeDb()
    const created = await createPage({ title: 'Anxiety', content: 'old voice' }, db)
    const id = created.success ? created.data.id : ''
    await updatePage(id, 'v2 from an entry', db) // entry_count -> 1, version -> 2

    const regen = await regeneratePageContent(id, 'rewritten in a consistent voice', db)
    expect(regen.success).toBe(true)
    if (regen.success) {
      expect(regen.data.content).toBe('rewritten in a consistent voice')
      expect(regen.data.version).toBe(3) // version bumped
      expect(regen.data.entry_count).toBe(1) // unchanged — no new entry
      expect(regen.data.version_history.at(-1)?.content).toBe('v2 from an entry') // old archived
    }
  })

  it('regeneratePageContent clears a prior user correction flag', async () => {
    const { db } = createFakeDb()
    const created = await createPage({ title: 'Anxiety', content: 'c' }, db)
    const id = created.success ? created.data.id : ''
    const regen = await regeneratePageContent(id, 'fresh', db)
    expect(regen.success && regen.data.corrected_at).toBeNull()
  })

  it('correctPage returns WIKI_NOT_FOUND for a missing id', async () => {
    const { db } = createFakeDb()
    const result = await correctPage('ghost', 'x', db)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('WIKI_NOT_FOUND')
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

  it('capVersionHistory keeps the first, monthly mid, and last N versions', () => {
    // 30 versions: many cluster in the same months so monthly dedup trims the mid
    const versions: WikiPageVersion[] = [
      // v1 — Jan 2025 (1st)
      { version: 1, content: 'v1', updated_at: new Date('2025-01-05').getTime() },
      // v2–v8 — Feb 2025 (7 updates, dedup to 1)
      ...Array.from({ length: 7 }, (_, i) => ({
        version: i + 2, content: `v${i + 2}`, updated_at: new Date('2025-02-10').getTime() + i * 86_400_000,
      })),
      // v9–v11 — Mar 2025 (3 updates, dedup to 1)
      ...Array.from({ length: 3 }, (_, i) => ({
        version: i + 9, content: `v${i + 9}`, updated_at: new Date('2025-03-15').getTime() + i * 86_400_000,
      })),
      // v12 — Apr 2025 (1 update counted)
      { version: 12, content: 'v12', updated_at: new Date('2025-04-01').getTime() },
      // v13 — May 2025 (1 update counted)
      { version: 13, content: 'v13', updated_at: new Date('2025-05-01').getTime() },
      // v14–v20 — Jul 2025 (7 updates, dedup to 1; note Jun has 0)
      ...Array.from({ length: 7 }, (_, i) => ({
        version: i + 14, content: `v${i + 14}`, updated_at: new Date('2025-07-10').getTime() + i * 86_400_000,
      })),
      // v21–v30 — last 10 untouched
      ...Array.from({ length: 10 }, (_, i) => ({
        version: i + 21, content: `v${i + 21}`, updated_at: new Date('2025-12-01').getTime() + i * 86_400_000,
      })),
    ].sort((a, b) => a.version - b.version)

    const capped = capVersionHistory(versions)
    expect(capped.length).toBeLessThanOrEqual(20)
    // First version is always present
    expect(capped[0].version).toBe(1)
    // Last 10 versions are always present
    expect(capped.slice(-10).map((v) => v.version)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
    // Monthly mid — at most one per distinct YYYY-MM between v2 and v20
    const mid = capped.slice(1, -10)
    const months = mid.map((v) => new Date(v.updated_at).toISOString().slice(0, 7))
    expect(new Set(months).size).toBe(months.length) // no duplicate months
    // Expected months: Feb, Mar, Apr, May, Jul
    expect(months).toEqual(['2025-02', '2025-03', '2025-04', '2025-05', '2025-07'])
  })

  it('capVersionHistory does not trim when under the limit', () => {
    const versions: WikiPageVersion[] = Array.from({ length: 15 }, (_, i) => ({
      version: i + 1,
      content: `v${i + 1}`,
      updated_at: Date.now() - i * 86_400_000,
    }))
    const capped = capVersionHistory(versions)
    expect(capped).toEqual(versions)
  })

  it('updatePage caps version_history past 20 versions', async () => {
    const { db } = createFakeDb()
    const created = await createPage({ title: 'Anxiety', content: 'v1' }, db)
    const id = created.success ? created.data.id : ''

    // Simulate 25 updates — history should be capped
    for (let i = 2; i <= 26; i++) {
      await updatePage(id, `v${i}`, db)
    }
    const page = await getPage(id, db)
    expect(page.success && page.data?.version_history.length).toBeLessThanOrEqual(20)
    // First entry is v1
    expect(page.success && page.data?.version_history[0].version).toBe(1)
    // Last entry is v25
    expect(page.success && page.data?.version_history.slice(-1)[0].version).toBe(25)
  })
})
