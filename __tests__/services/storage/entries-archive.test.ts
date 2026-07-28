import {
  countJournalEntries,
  getJournalEntryNeighbors,
  listJournalEntriesPage,
  listJournalEmotions,
  type Entry,
} from '@/services/storage/entries'
import { type SqliteDatabase } from '@/services/storage/db'

const row = (id: string, created_at: number, emotion: string | null = null) => ({
  id,
  created_at,
  mood: 3,
  situation: `situation ${id}`,
  thought: '',
  behavior: null,
  closing_note: null,
  emotion,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
})

function fakeDb(handler: (sql: string, params: (string | number | null)[]) => Record<string, unknown>[]) {
  return {
    execute: jest.fn(async (sql: string, params: (string | number | null)[] = []) => ({
      rows: handler(sql, params),
      rowsAffected: 0,
    })),
    transaction: async () => undefined,
    close: () => undefined,
  } as unknown as SqliteDatabase & { execute: jest.Mock }
}

describe('journal archive storage contract', () => {
  it('uses stable keyset ordering and limit-plus-one cursor', async () => {
    const db = fakeDb((sql, params) => {
      expect(sql).toContain("source = 'journal'")
      expect(sql).toContain('ORDER BY created_at DESC, id DESC')
      expect(params).toEqual([4])
      return [row('c', 300), row('b', 200), row('a', 100), row('reflect', 50)]
    })

    const result = await listJournalEntriesPage({ limit: 3 }, db)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.items.map((entry) => entry.id)).toEqual(['c', 'b', 'a'])
      expect(result.data.hasMore).toBe(true)
      expect(result.data.nextCursor).toEqual({ createdAt: 100, id: 'a' })
    }
  })

  it('escapes LIKE metacharacters while keeping search parameterized', async () => {
    const db = fakeDb((sql, params) => {
      expect(sql).toContain("situation LIKE ? ESCAPE '\\'")
      expect(sql).not.toContain('topic2 LIKE ? ESCAPE')
      expect(params.slice(0, 4)).toEqual(Array(4).fill('%100\\% real\\_path\\\\%'))
      return []
    })

    const result = await listJournalEntriesPage({ query: '100% real_path\\', limit: 10 }, db)
    expect(result.success).toBe(true)
  })

  it('combines cursor and exact emotion filtering with journal-only source boundary', async () => {
    const db = fakeDb((sql, params) => {
      expect(sql).toContain("source = 'journal'")
      expect(sql).toContain('emotion = ?')
      expect(sql).not.toContain('emotion = ? COLLATE NOCASE')
      expect(sql).toContain('(created_at < ? OR (created_at = ? AND id < ?))')
      expect(params).toEqual(['Joy', 200, 200, 'b', 31])
      return []
    })

    await listJournalEntriesPage({ emotion: 'Joy', cursor: { createdAt: 200, id: 'b' }, limit: 30 }, db)
  })

  it('counts and de-duplicates non-blank emotions from journal rows', async () => {
    const db = fakeDb((sql) => {
      if (sql.startsWith('SELECT COUNT')) return [{ n: 7 }]
      return [{ emotion: 'Anxiety' }, { emotion: 'anxiety' }, { emotion: ' Joy ' }, { emotion: ' ' }]
    })
    expect(await countJournalEntries(db)).toEqual({ success: true, data: 7 })
    expect(await listJournalEmotions(db)).toEqual({ success: true, data: ['Anxiety', 'Joy'] })
  })

  it('finds older and newer neighbors using the same tie-break ordering', async () => {
    const current = row('b', 100) as unknown as Entry
    const db = fakeDb((sql) => {
      if (sql.includes('ORDER BY created_at DESC')) return [row('a', 100)]
      return [row('c', 100)]
    })
    const result = await getJournalEntryNeighbors(current, db)
    expect(result).toEqual({ success: true, data: { older: expect.objectContaining({ id: 'a' }), newer: expect.objectContaining({ id: 'c' }) } })
  })
})