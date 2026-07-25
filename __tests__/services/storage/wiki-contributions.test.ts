// F-01 Slice 7a — wiki_page_contributions receipt module tests.
// All query interactions go through the public helper interface; no SQL
// assumption leaks beyond what the helper encapsulates.

import { type SqliteDatabase } from '@/services/storage/db'
import {
  insertContribution,
  hasContribution,
  insertMissingReceipts,
} from '@/services/storage/wiki-contributions'

function createFakeDb() {
  const contributions = new Map<string, { entry_id: string; page_id: string; created_at: number }>()
  const db: SqliteDatabase = {
    async execute(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (/^INSERT OR IGNORE INTO wiki_page_contributions/.test(s)) {
        const [entryId, pageId, createdAt] = params
        const key = `${String(entryId)}::${String(pageId)}`
        if (contributions.has(key)) return { rows: [], rowsAffected: 0 }
        contributions.set(key, { entry_id: String(entryId), page_id: String(pageId), created_at: Number(createdAt) })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT entry_id FROM wiki_page_contributions WHERE entry_id = \? AND page_id = \?/.test(s)) {
        const key = `${String(params[0])}::${String(params[1])}`
        return { rows: contributions.has(key) ? [{ entry_id: String(params[0]) }] : [], rowsAffected: 0 }
      }
      if (/^SELECT entry_id FROM wiki_page_contributions WHERE entry_id IN/.test(s)) {
        const pageId = String(params[params.length - 1])
        const entryIds: string[] = params.slice(0, -1).map(String)
        const matched = new Set(
          [...contributions.values()].filter((c) => c.page_id === pageId).map((c) => c.entry_id)
        )
        return { rows: entryIds.filter((id) => matched.has(id)).map((id) => ({ entry_id: id })), rowsAffected: 0 }
      }
      if (/^INSERT OR IGNORE INTO wiki_page_contributions \(entry_id, page_id, created_at\) VALUES/.test(s)) {
        // batch insert — count how many new
        const pageId = String(params[params.length - 1])
        const batch = params.slice(0, -1).map((_, i) => String(params[i]))
        let inserted = 0
        for (let i = 0; i < batch.length - 1; i++) {
          const key = `${batch[i]}::${pageId}`
          if (!contributions.has(key)) {
            contributions.set(key, { entry_id: batch[i], page_id: pageId, created_at: Date.now() })
            inserted++
          }
        }
        return { rows: [], rowsAffected: inserted }
      }
      return { rows: [], rowsAffected: 0 }
    },
    async transaction(fn: (tx: SqliteDatabase) => Promise<void>) { await fn(db) },
    close() {},
  }
  return { db, contributions }
}

describe('wiki_page_contributions — receipt module', () => {
  describe('insertContribution', () => {
    it('returns inserted=true for a new receipt', async () => {
      const { db } = createFakeDb()
      const r = await insertContribution('e1', 'p1', db)
      expect(r.success).toBe(true)
      expect(r.success && r.data.inserted).toBe(true)
    })

    it('returns inserted=false for a duplicate receipt', async () => {
      const { db } = createFakeDb()
      await insertContribution('e1', 'p1', db)
      const r = await insertContribution('e1', 'p1', db)
      expect(r.success && r.data.inserted).toBe(false)
    })
  })

  describe('hasContribution', () => {
    it('returns false when no receipt exists', async () => {
      const { db } = createFakeDb()
      const r = await hasContribution('e1', 'p1', db)
      expect(r.success && r.data).toBe(false)
    })

    it('returns true after insertContribution', async () => {
      const { db } = createFakeDb()
      await insertContribution('e1', 'p1', db)
      const r = await hasContribution('e1', 'p1', db)
      expect(r.success && r.data).toBe(true)
    })
  })

  describe('insertMissingReceipts', () => {
    it('inserts only missing receipt IDs', async () => {
      const { db, contributions } = createFakeDb()
      const pageId = 'p1'
      await insertContribution('existing', pageId, db)
      const r = await insertMissingReceipts(['existing', 'missing', 'also-missing'], pageId, db)
      expect(r.success).toBe(true)
      expect(r.success && r.data.inserted).toBe(2)
      // existing stays as-is
      expect(contributions.has('existing::p1')).toBe(true)
      expect(contributions.has('missing::p1')).toBe(true)
      expect(contributions.has('also-missing::p1')).toBe(true)
    })

    it('returns inserted=0 when all receipts already exist', async () => {
      const { db } = createFakeDb()
      const pageId = 'p1'
      await insertContribution('a', pageId, db)
      await insertContribution('b', pageId, db)
      const r = await insertMissingReceipts(['a', 'b'], pageId, db)
      expect(r.success && r.data.inserted).toBe(0)
    })

    it('returns inserted=0 for empty entryIds array', async () => {
      const { db } = createFakeDb()
      const r = await insertMissingReceipts([], 'p1', db)
      expect(r.success && r.data.inserted).toBe(0)
    })
  })
})
