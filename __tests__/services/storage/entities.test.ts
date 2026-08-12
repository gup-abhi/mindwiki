import { type SqliteDatabase } from '@/services/storage/db'
import {
  setEntitiesForEntry,
  listEntitiesForEntry,
  countEntriesForEntity,
  effectiveLabel,
  setCanonicalLabel,
  type EntryEntity,
} from '@/services/storage/entities'
import { enqueueUpsert } from '@/services/storage/sync-queue'

jest.mock('@/services/storage/sync-queue', () => ({
  enqueueUpsert: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
  enqueueUpsertInTransaction: jest.fn(() => Promise.resolve()),
  notifySyncPending: jest.fn(),
}))

const mockEnqueue = enqueueUpsert as jest.Mock
const mockEnqueueInTransaction = jest.requireMock('@/services/storage/sync-queue').enqueueUpsertInTransaction as jest.Mock

function createFakeDb() {
  let rows: Record<string, unknown>[] = []
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^DELETE FROM entry_entities WHERE entry_id/.test(sql)) {
        rows = rows.filter((r) => r.entry_id !== params[0])
        return { rows: [], rowsAffected: 0 }
      }
      if (/^INSERT INTO entry_entities/.test(sql)) {
        // F-02B: 7 columns incl. canonical_label + updated_at
        const [id, entry_id, type, label, canonical_label, created_at, updated_at] = params
        rows.push({ id, entry_id, type, label, canonical_label, created_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      // F-02B: setEntitiesForEntry pre-reads existing rows so canonical_label
      // survives a replace-set.
      if (/^SELECT id, canonical_label FROM entry_entities WHERE entry_id/.test(sql)) {
        return {
          rows: rows
            .filter((r) => r.entry_id === params[0])
            .map((r) => ({ id: r.id, canonical_label: r.canonical_label ?? null })),
          rowsAffected: 0,
        }
      }
      if (/^SELECT \* FROM entry_entities WHERE entry_id/.test(sql)) {
        return { rows: rows.filter((r) => r.entry_id === params[0]), rowsAffected: 0 }
      }
      if (/^SELECT COUNT\(DISTINCT entry_id\)/.test(sql)) {
        // F-02B: match by COALESCE(canonical_label, label) COLLATE NOCASE
        const ids = new Set(
          rows
            .filter(
              (r) =>
                r.type === params[0] &&
                String(r.canonical_label ?? r.label).toLowerCase() ===
                  String(params[1]).toLowerCase()
            )
            .map((r) => r.entry_id)
        )
        return { rows: [{ n: ids.size }], rowsAffected: 0 }
      }
      if (/^UPDATE entry_entities[\s\S]*SET canonical_label/.test(sql)) {
        // setCanonicalLabel: SET canonical_label = ?, updated_at = MAX(updated_at, ?) WHERE id = ?
        const [canon, , id] = params
        const row = rows.find((r) => r.id === id)
        if (row) row.canonical_label = canon
        return { rows: [], rowsAffected: row ? 1 : 0 }
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

  it('F-02B: effectiveLabel returns trimmed canonical when set, else raw label', () => {
    const base = (over: Partial<EntryEntity> = {}): EntryEntity => ({
      id: 'x', entry_id: 'e', type: 'belief', label: 'I am unlovable',
      created_at: 0, canonical_label: null, updated_at: 0, ...over,
    })
    expect(effectiveLabel(base({ canonical_label: 'I am unworthy' }))).toBe('I am unworthy')
    expect(effectiveLabel(base({ canonical_label: '  I am unworthy  ' }))).toBe('I am unworthy')
    expect(effectiveLabel(base({ canonical_label: null }))).toBe('I am unlovable')
    expect(effectiveLabel(base({ canonical_label: '' }))).toBe('I am unlovable')
  })

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
    expect(mockEnqueueInTransaction).toHaveBeenCalledTimes(2)
    expect(mockEnqueueInTransaction).toHaveBeenCalledWith('entry_entities', 'e1:person:alice', expect.anything())
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

  it('F-02B: preserves an existing canonical_label across a replace-set', async () => {
    const { db } = createFakeDb()
    // Stable canonical id: alice@e1:person:alice. Seed it then stamp a canonical.
    await setEntitiesForEntry('e1', [{ type: 'belief', label: 'I am unlovable' }], db)
    await setCanonicalLabel('e1:belief:i am unlovable', 'I am unworthy', db)
    // Re-extract on a catch-up run emits the SAME raw belief — canonical must not
    // be wiped by the delete-then-insert.
    await setEntitiesForEntry('e1', [{ type: 'belief', label: 'I am unlovable' }], db)
    const list = await listEntitiesForEntry('e1', db)
    expect(list.success && list.data[0].canonical_label).toBe('I am unworthy')
  })

  it("F-02B: counts by effective label so a canonicalized alias counts under its canonical identity", async () => {
    const { db } = createFakeDb()
    // Entry e1 believes the raw alias, entry e2 has the canonical itself.
    await setEntitiesForEntry('e1', [{ type: 'belief', label: 'I am unlovable' }], db)
    await setCanonicalLabel('e1:belief:i am unlovable', 'I am unworthy', db)
    await setEntitiesForEntry('e2', [{ type: 'belief', label: 'I am unworthy' }], db)
    // Both → one canonical wiki identity:
    expect(countEntriesForEntity('belief', 'I am unworthy', db)).resolves.toMatchObject({
      success: true,
      data: 2,
    })
    // Raw alias alone, after canonicalization, no longer aggregates its own count:
    expect(countEntriesForEntity('belief', 'I am unlovable', db)).resolves.toMatchObject({
      success: true,
      data: 0,
    })
  })

  it("F-02B: setCanonicalLabel rejects an empty canonical", async () => {
    const { db } = createFakeDb()
    const res = await setCanonicalLabel('e1:belief:i am unlovable', '   ', db)
    expect(res.success).toBe(false)
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
