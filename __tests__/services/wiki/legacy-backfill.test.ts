import {
  backfillLegacyWikiPages,
  isLegacyEmptyV1,
  repairLegacyPage,
  repairLegacyRow,
} from '@/services/wiki/legacy-backfill'
import { type WikiPage } from '@/services/storage/wiki'
import { type SqliteDatabase, type QueryResult } from '@/services/storage/db'

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1', title: 'Work', category: 'theme', content: 'current', entry_count: 3,
    version: 3,
    version_history: [
      { version: 1, content: '', updated_at: 10 },
      { version: 2, content: 'first synthesis', updated_at: 20 },
    ],
    created_at: 1, updated_at: 30, dismissed_at: null, corrected_at: null,
    merged_into: null, aggregated_upto: 0, regrounded_upto: 0, ...overrides,
  }
}

describe('legacy wiki empty-v1 repair', () => {
  it('detects any page with empty v1 and later real content', () => {
    expect(isLegacyEmptyV1(page())).toBe(true)
    expect(isLegacyEmptyV1(page({ category: 'emotion' }))).toBe(true)
    expect(isLegacyEmptyV1(page({ version_history: [{ version: 1, content: 'real', updated_at: 10 }] }))).toBe(false)
    expect(isLegacyEmptyV1(page({ version: 2, content: '', version_history: [{ version: 1, content: '', updated_at: 10 }] }))).toBe(false)
  })

  it('does not treat a contentful emotion placeholder as an empty shell', () => {
    expect(isLegacyEmptyV1(page({
      category: 'emotion',
      version: 1,
      content: "You've just started noticing anxiety.",
      version_history: [],
    }))).toBe(false)
  })

  it('detects empty v1 when version 2 was sampled out of retained history', () => {
    expect(isLegacyEmptyV1(page({
      version: 15,
      version_history: [
        { version: 1, content: '', updated_at: 10 },
        { version: 14, content: 'retained synthesis', updated_at: 140 },
      ],
    }))).toBe(true)
  })

  it('removes empty v1, shifts history, and decrements current version', () => {
    const repaired = repairLegacyPage(page())
    expect(repaired).not.toBeNull()
    expect(repaired?.version).toBe(2)
    expect(repaired?.content).toBe('current')
    expect(repaired?.entry_count).toBe(3)
    expect(repaired?.version_history).toEqual([{ version: 1, content: 'first synthesis', updated_at: 20 }])
    expect(repairLegacyPage(repaired!)).toBeNull()
  })

  it('repairs serialized sync rows without touching current content', () => {
    const row = repairLegacyRow({ ...page(), version_history: JSON.stringify(page().version_history) })
    expect(row).not.toBeNull()
    expect(row?.version).toBe(2)
    expect(row?.content).toBe('current')
    expect(JSON.parse(String(row?.version_history))).toEqual([{ version: 1, content: 'first synthesis', updated_at: 20 }])
  })
})

describe('backfillLegacyWikiPages', () => {
  it('repairs rows, queues them, and marks completion', async () => {
    const executed: string[] = []

    const db: SqliteDatabase = {
      execute: jest.fn(async (sql: string): Promise<QueryResult> => {
        executed.push(sql)
        if (sql === 'SELECT * FROM wiki_pages') {
          return { rows: [{ ...page(), version_history: JSON.stringify(page().version_history) }], rowsAffected: 0 }
        }
        return { rows: [], rowsAffected: 1 }
      }),
      transaction: jest.fn(async (fn: (tx: SqliteDatabase) => Promise<void>): Promise<void> => fn(db)),
      close() {},
    }
    const result = await backfillLegacyWikiPages(db)
    expect(result).toEqual({ success: true, data: 1 })
    expect(executed.some((sql) => sql.includes('UPDATE wiki_pages'))).toBe(true)
    expect(executed.some((sql) => sql.includes('sync_queue'))).toBe(true)
    expect(executed.some((sql) => sql.includes('settings'))).toBe(true)
  })
})