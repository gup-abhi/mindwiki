import { type SqliteDatabase } from '@/services/storage/db'
import { type WikiPage } from '@/services/storage/wiki'
import { enqueueUpsert } from '@/services/storage/sync-queue'
import { rebuildGraph } from '@/services/graph/engine'
import { suggestMerges, mergePages, pairKey, MERGE_THRESHOLD } from '@/services/wiki/merge'

jest.mock('@/services/storage/sync-queue', () => ({
  enqueueUpsert: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))
jest.mock('@/services/graph/engine', () => ({
  rebuildGraph: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))

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
  ...over,
})

// Unit vectors: [1,0] and [1,0] → cosine 1; [0,1] → cosine 0 with them.
const V_A = [1, 0]
const V_ORTH = [0, 1]

describe('suggestMerges', () => {
  it('suggests a near-duplicate theme pair, richer page as survivor', () => {
    const a = page({ id: 'a', title: 'Work stress', entry_count: 2 })
    const b = page({ id: 'b', title: 'Job pressure', entry_count: 5 })
    const vectors = new Map([
      ['a', V_A],
      ['b', V_A],
    ])

    const pairs = suggestMerges([a, b], vectors)

    expect(pairs).toHaveLength(1)
    expect(pairs[0].survivor.id).toBe('b') // richer
    expect(pairs[0].loser.id).toBe('a')
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(MERGE_THRESHOLD)
  })

  it('drops pairs below the similarity threshold', () => {
    const a = page({ id: 'a', title: 'Work stress' })
    const b = page({ id: 'b', title: 'Gardening' })
    const vectors = new Map([
      ['a', V_A],
      ['b', V_ORTH],
    ])
    expect(suggestMerges([a, b], vectors)).toEqual([])
  })

  it('only considers theme pages (never emotion/distortion/person/place)', () => {
    const a = page({ id: 'a', title: 'Anxiety', category: 'emotion' })
    const b = page({ id: 'b', title: 'Worry', category: 'emotion' })
    const vectors = new Map([
      ['a', V_A],
      ['b', V_A],
    ])
    expect(suggestMerges([a, b], vectors)).toEqual([])
  })

  it('skips dismissed, already-merged, and unembedded pages', () => {
    const a = page({ id: 'a', title: 'Work stress' })
    const dismissed = page({ id: 'b', title: 'Job pressure', dismissed_at: 1 })
    const merged = page({ id: 'c', title: 'Career worry', merged_into: 'a' })
    const noVec = page({ id: 'd', title: 'Office dread' })
    const vectors = new Map([
      ['a', V_A],
      ['b', V_A],
      ['c', V_A],
      // 'd' has no vector
    ])
    expect(suggestMerges([a, dismissed, merged, noVec], vectors)).toEqual([])
  })

  it('excludes suppressed pairs (order-independent)', () => {
    const a = page({ id: 'a', title: 'Work stress' })
    const b = page({ id: 'b', title: 'Job pressure' })
    const vectors = new Map([
      ['a', V_A],
      ['b', V_A],
    ])
    const suppressed = new Set([pairKey('Job pressure', 'Work stress')])
    expect(suggestMerges([a, b], vectors, suppressed)).toEqual([])
  })

  it('sorts pairs most-similar first', () => {
    const a = page({ id: 'a', title: 'Work stress' })
    const b = page({ id: 'b', title: 'Job pressure' })
    const c = page({ id: 'c', title: 'Deadlines' })
    // b≈a exactly (1.0); c≈a high but < 1.0
    const vectors = new Map([
      ['a', [1, 0]],
      ['b', [1, 0]],
      ['c', [0.95, 0.31]], // cosine with a ≈ 0.95
    ])
    const pairs = suggestMerges([a, b, c], vectors)
    expect(pairs.length).toBeGreaterThanOrEqual(2)
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(pairs[1].similarity)
  })
})

// Fake DB backing the raw queries mergePages issues.
function createFakeDb() {
  const entries = new Map<string, { id: string; topic: string }>()
  const pageUpdates: Array<{ sql: 'merged_into' | 'entry_count'; params: unknown[] }> = []
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^SELECT id FROM entries WHERE topic/.test(sql)) {
        const [topic] = params as string[]
        return {
          rows: [...entries.values()].filter((e) => e.topic === topic).map((e) => ({ id: e.id })),
          rowsAffected: 0,
        }
      }
      if (/^UPDATE entries SET topic/.test(sql)) {
        const [topic, id] = params as string[]
        const row = entries.get(String(id))
        if (row) row.topic = String(topic)
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE wiki_pages SET merged_into/.test(sql)) {
        pageUpdates.push({ sql: 'merged_into', params })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE wiki_pages SET entry_count/.test(sql)) {
        pageUpdates.push({ sql: 'entry_count', params })
        return { rows: [], rowsAffected: 1 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, entries, pageUpdates }
}

describe('mergePages', () => {
  beforeEach(() => {
    mockRebuild.mockClear()
    ;(enqueueUpsert as jest.Mock).mockClear()
  })

  it('re-points the loser topic entries onto the survivor and enqueues them', async () => {
    const { db, entries } = createFakeDb()
    entries.set('e1', { id: 'e1', topic: 'Job pressure' })
    entries.set('e2', { id: 'e2', topic: 'Job pressure' })
    entries.set('e3', { id: 'e3', topic: 'Cooking' }) // untouched

    const survivor = page({ id: 's', title: 'Work stress', entry_count: 5 })
    const loser = page({ id: 'l', title: 'Job pressure', entry_count: 3 })

    const res = await mergePages(survivor, loser, db)

    expect(res.success && res.data.entriesRepointed).toBe(2)
    expect(entries.get('e1')!.topic).toBe('Work stress')
    expect(entries.get('e2')!.topic).toBe('Work stress')
    expect(entries.get('e3')!.topic).toBe('Cooking')
    expect(enqueueUpsert).toHaveBeenCalledWith('entries', 'e1', db)
    expect(enqueueUpsert).toHaveBeenCalledWith('entries', 'e2', db)
  })

  it('flags the loser merged_into survivor and folds its entry_count', async () => {
    const { db, pageUpdates } = createFakeDb()
    const survivor = page({ id: 's', title: 'Work stress', entry_count: 5 })
    const loser = page({ id: 'l', title: 'Job pressure', entry_count: 3 })

    await mergePages(survivor, loser, db)

    const merge = pageUpdates.find((u) => u.sql === 'merged_into')!
    expect(merge.params[0]).toBe('s') // merged_into = survivor id
    expect(merge.params[2]).toBe('l') // where id = loser id

    const bump = pageUpdates.find((u) => u.sql === 'entry_count')!
    expect(bump.params[0]).toBe(8) // 5 + 3
    expect(bump.params[2]).toBe('s')

    expect(mockRebuild).toHaveBeenCalled()
  })
})
