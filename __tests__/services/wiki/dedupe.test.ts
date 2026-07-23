import { type SqliteDatabase } from '@/services/storage/db'
import { dedupeTopics } from '@/services/wiki/dedupe'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { enqueueUpsert } from '@/services/storage/sync-queue'
import { rebuildGraph } from '@/services/graph/engine'

jest.mock('@/services/storage/wiki', () => ({ listPages: jest.fn() }))
jest.mock('@/services/storage/sync-queue', () => ({
  enqueueUpsert: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))
jest.mock('@/services/graph/engine', () => ({
  rebuildGraph: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))

const mockListPages = listPages as jest.Mock
const mockRebuild = rebuildGraph as jest.Mock

const page = (over: Partial<WikiPage>): WikiPage => ({
  id: 'x',
  title: 'X',
  category: 'theme',
  content: '',
  entry_count: 0,
  version: 1,
  version_history: [],
  created_at: 0,
  updated_at: 0,
  dismissed_at: null,
  corrected_at: null,
  merged_into: null,
  aggregated_upto: 0,
  ...over,
})

// Fake DB backing the raw queries dedupeTopics issues.
function createFakeDb() {
  const entries = new Map<string, { id: string; topic: string; topic2: string }>()
  const titleUpdates: Array<{ id: string; title: string }> = []
  const merges: Array<{ id: string; into: string }> = []
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^SELECT id, topic, topic2 FROM entries/.test(sql)) {
        return { rows: [...entries.values()], rowsAffected: 0 }
      }
      if (/^UPDATE entries SET topic = \?, updated_at/.test(sql)) {
        const [topic, , id] = params as string[]
        const row = entries.get(String(id))
        if (row) row.topic = String(topic)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE entries SET topic2 = \?, updated_at/.test(sql)) {
        const [topic, , id] = params as string[]
        const row = entries.get(String(id))
        if (row) row.topic2 = String(topic)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE wiki_pages SET title/.test(sql)) {
        const [title, , id] = params as string[]
        titleUpdates.push({ id: String(id), title: String(title) })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE wiki_pages SET merged_into/.test(sql)) {
        const [into, , id] = params as string[]
        merges.push({ id: String(id), into: String(into) })
        return { rows: [], rowsAffected: 1 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, entries, titleUpdates, merges }
}

describe('dedupeTopics', () => {
  beforeEach(() => {
    mockListPages.mockReset().mockResolvedValue({ success: true, data: [] })
    mockRebuild.mockClear()
    ;(enqueueUpsert as jest.Mock).mockClear()
  })

  it('re-derives plural entry topics to their singular form', async () => {
    const { db, entries } = createFakeDb()
    entries.set('e1', { id: 'e1', topic: 'Relationships', topic2: '' })
    entries.set('e2', { id: 'e2', topic: 'Relationship', topic2: '' }) // already singular
    entries.set('e3', { id: 'e3', topic: 'Stress', topic2: '' }) // unchanged

    const res = await dedupeTopics(db)

    expect(res.success && res.data.entriesUpdated).toBe(1)
    expect(entries.get('e1')!.topic).toBe('Relationship')
    expect(entries.get('e3')!.topic).toBe('Stress')
    expect(mockRebuild).toHaveBeenCalled()
  })

  it('keeps the singular page and merges the plural duplicate into it', async () => {
    const { db, merges } = createFakeDb()
    mockListPages.mockResolvedValue({
      success: true,
      data: [
        page({ id: 'plural', title: 'Relationships', category: 'theme', entry_count: 5 }),
        page({ id: 'singular', title: 'Relationship', category: 'theme', entry_count: 2 }),
      ],
    })

    const res = await dedupeTopics(db)

    // survivor is the canonically-titled page even though the plural is richer
    expect(res.success && res.data.pagesMerged).toBe(1)
    expect(merges).toEqual([{ id: 'plural', into: 'singular' }])
  })

  it('retitles the survivor when no page is already singular', async () => {
    const { db, titleUpdates, merges } = createFakeDb()
    mockListPages.mockResolvedValue({
      success: true,
      data: [
        page({ id: 'a', title: 'Relationships', category: 'theme', entry_count: 5 }),
        page({ id: 'b', title: 'RELATIONSHIPS', category: 'theme', entry_count: 1 }),
      ],
    })

    await dedupeTopics(db)

    expect(titleUpdates).toContainEqual({ id: 'a', title: 'Relationship' })
    expect(merges).toEqual([{ id: 'b', into: 'a' }])
  })

  it('leaves non-theme pages alone (emotions/people never singularize)', async () => {
    const { db, merges } = createFakeDb()
    mockListPages.mockResolvedValue({
      success: true,
      data: [
        page({ id: 'p1', title: 'Athens', category: 'place', entry_count: 3 }),
        page({ id: 'p2', title: 'Athen', category: 'place', entry_count: 1 }),
      ],
    })

    const res = await dedupeTopics(db)
    expect(res.success && res.data.pagesMerged).toBe(0)
    expect(merges).toEqual([])
  })
})
