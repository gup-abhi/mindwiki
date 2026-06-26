import { type SqliteDatabase } from '@/services/storage/db'
import { clearFrozenDays, freezeDays, listFrozenDays } from '@/services/storage/streak-freezes'
import { enqueueUpsert } from '@/services/storage/sync-queue'

jest.mock('@/services/storage/sync-queue', () => ({
  enqueueUpsert: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))
const mockEnqueue = enqueueUpsert as jest.Mock

// In-memory fake backing the exact queries streak-freezes.ts issues.
function createFakeDb() {
  const rows = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql: string, params: unknown[] = []) {
      if (/^INSERT INTO streak_freezes/.test(sql)) {
        const [id, day_index, frozen_at, updated_at] = params
        const key = String(id)
        const prior = rows.get(key)
        rows.set(key, { id, day_index, frozen_at: prior?.frozen_at ?? frozen_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT day_index FROM streak_freezes/.test(sql)) {
        return { rows: [...rows.values()].map((r) => ({ day_index: r.day_index })), rowsAffected: 0 }
      }
      if (/^DELETE FROM streak_freezes/.test(sql)) {
        const n = rows.size
        rows.clear()
        return { rows: [], rowsAffected: n }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn: (tx: SqliteDatabase) => Promise<void>) {
      await fn(db)
    },
    close() {},
  } as unknown as SqliteDatabase
  return { db, rows }
}

describe('streak-freezes storage', () => {
  beforeEach(() => mockEnqueue.mockClear())

  it('records frozen days and lists them as a set, enqueuing each for sync', async () => {
    const { db } = createFakeDb()
    const res = await freezeDays([19_900, 19_901], db)
    expect(res.success).toBe(true)
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    expect(mockEnqueue).toHaveBeenCalledWith('streak_freezes', '19900', db)

    const list = await listFrozenDays(db)
    expect(list.success && list.data).toEqual(new Set([19_900, 19_901]))
  })

  it('is idempotent — re-freezing a day does not duplicate it', async () => {
    const { db, rows } = createFakeDb()
    await freezeDays([19_900], db)
    await freezeDays([19_900], db)
    expect(rows.size).toBe(1)
    const list = await listFrozenDays(db)
    expect(list.success && list.data).toEqual(new Set([19_900]))
  })

  it('returns an empty set when nothing is frozen', async () => {
    const { db } = createFakeDb()
    const list = await listFrozenDays(db)
    expect(list.success && list.data).toEqual(new Set())
  })

  it('clears all frozen days (dev reset)', async () => {
    const { db } = createFakeDb()
    await freezeDays([19_900, 19_901], db)
    await clearFrozenDays(db)
    const list = await listFrozenDays(db)
    expect(list.success && list.data).toEqual(new Set())
  })
})
