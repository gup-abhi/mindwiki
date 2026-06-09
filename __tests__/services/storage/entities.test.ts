import { type SqliteDatabase } from '@/services/storage/db'
import {
  setEntitiesForEntry,
  listEntitiesForEntry,
  countEntriesForEntity,
} from '@/services/storage/entities'
import { enqueueUpsert } from '@/services/storage/sync-queue'

jest.mock('@/services/storage/sync-queue', () => ({
  enqueueUpsert: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))

const mockEnqueue = enqueueUpsert as jest.Mock

function createFakeDb() {
  let rows: Record<string, unknown>[] = []
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^DELETE FROM entry_entities WHERE entry_id/.test(sql)) {
        rows = rows.filter((r) => r.entry_id !== params[0])
        return { rows: [], rowsAffected: 0 }
      }
      if (/^INSERT INTO entry_entities/.test(sql)) {
        const [id, entry_id, type, label, created_at] = params
        rows.push({ id, entry_id, type, label, created_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM entry_entities WHERE entry_id/.test(sql)) {
        return { rows: rows.filter((r) => r.entry_id === params[0]), rowsAffected: 0 }
      }
      if (/^SELECT COUNT\(DISTINCT entry_id\)/.test(sql)) {
        const ids = new Set(
          rows
            .filter(
              (r) =>
                r.type === params[0] &&
                String(r.label).toLowerCase() === String(params[1]).toLowerCase()
            )
            .map((r) => r.entry_id)
        )
        return { rows: [{ n: ids.size }], rowsAffected: 0 }
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

describe('storage/entities', () => {
  beforeEach(() => mockEnqueue.mockClear())

  it('persists entities for an entry and enqueues each for sync', async () => {
    const { db } = createFakeDb()
    const res = await setEntitiesForEntry(
      'e1',
      [
        { type: 'person', label: 'Alice' },
        { type: 'place', label: 'Office' },
      ],
      db
    )
    expect(res.success).toBe(true)

    const list = await listEntitiesForEntry('e1', db)
    expect(list.success && list.data).toHaveLength(2)
    // deterministic id: `${entryId}:${type}:${labelLower}`
    expect(list.success && list.data.map((e) => e.id)).toEqual(['e1:person:alice', 'e1:place:office'])
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    expect(mockEnqueue).toHaveBeenCalledWith('entry_entities', 'e1:person:alice', db)
  })

  it('replaces the prior set (delete-then-insert) and drops blanks/dupes', async () => {
    const { db } = createFakeDb()
    await setEntitiesForEntry('e1', [{ type: 'person', label: 'Alice' }], db)
    await setEntitiesForEntry(
      'e1',
      [
        { type: 'person', label: 'Bob' },
        { type: 'person', label: 'bob' }, // case-dup of Bob → dropped
        { type: 'place', label: '   ' }, // blank → dropped
      ],
      db
    )
    const list = await listEntitiesForEntry('e1', db)
    expect(list.success && list.data.map((e) => e.label)).toEqual(['Bob'])
  })

  it('counts distinct entries mentioning an entity (case-insensitive)', async () => {
    const { db } = createFakeDb()
    await setEntitiesForEntry('e1', [{ type: 'person', label: 'Alice' }], db)
    await setEntitiesForEntry('e2', [{ type: 'person', label: 'alice' }], db)
    const count = await countEntriesForEntity('person', 'Alice', db)
    expect(count.success && count.data).toBe(2)
    const none = await countEntriesForEntity('place', 'Alice', db)
    expect(none.success && none.data).toBe(0)
  })
})
