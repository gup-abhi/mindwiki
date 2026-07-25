import { type SqliteDatabase } from '@/services/storage/db'
import {
  getMaintenanceState,
  updateMaintenanceState,
  incrementSourceGeneration,
} from '@/services/storage/maintenance-state'

function createFakeDb(stubSeed = true) {
  let row: Record<string, unknown> | null = stubSeed
    ? {
        key: 'belief',
        algorithm_version: 0,
        source_generation: 0,
        processed_generation: 0,
        status: 'idle',
        last_run_at: null,
        repaired_clusters: 0,
        deferred_clusters: 0,
        run_count: 0,
      }
    : null
  const ops: string[] = []
  const db: SqliteDatabase = {
    async execute(sql: string, params: (string | number | null)[] = []) {
      ops.push(sql.trim().replace(/\s+/g, ' '))
      if (/^INSERT INTO belief_maintenance_state .*ON CONFLICT\(key\) DO NOTHING/i.test(sql.trim().replace(/\s+/g, ' '))) {
        if (row == null) {
          row = {
            key: 'belief', algorithm_version: 0, source_generation: 0, processed_generation: 0,
            status: 'idle', last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, run_count: 0,
          }
        }
        return { rows: [], rowsAffected: 0 }
      }
      if (/^INSERT INTO belief_maintenance_state .*ON CONFLICT\(key\) DO UPDATE SET/i.test(sql.trim().replace(/\s+/g, ' '))) {
        // Extract bind positions from the SQL落幕 by matching the column order
        // the server uses (fields in fixed order + key). Mock as a no-op row
        // identity update — tests that assert on patch results read via
        // getMaintenanceState, so we apply the patch by parsing column list.
        // Simpler: caller calls updateMaintenanceState(patch); we capture the
        // patch via a sibling call-site hook. Since this fake only asserts
        // status writes, we apply algorithm_version / last_run_at / etc. by
        // reading them from the next getMaintenanceState call instead. To keep
        // the fake honest, we store the patch as the row directly here.
        // Parse column list from the first INSERT line.
        const colList = sql.match(/\((key, [\w_ ,]+)\)/)
        if (colList && row) {
          const cols = colList[1].split(',').map((c) => c.trim())
          // bind order: [key, ...fields in order, ...patch values for updates]
          // but the execute call's params are [key, field-value-or-null..., ...patch values].
          // Easier: extract SET assignments from the SQL and bind them.
          const setMatch = sql.match(/DO UPDATE SET (.+)$/)
          if (setMatch) {
            const assigns = setMatch[1].split(',').map((s) => s.trim().split(' = ')[0].trim())
            // patch params follow the field slots. We laid out execParams as
            // [key, fields..., patch-params...]. Find patch start = 1 + fields.length.
            const fieldCount = cols.length - 1 // subtract the 'key' col
            const patchStart = 1 + fieldCount
            for (let i = 0; i < assigns.length; i++) {
              const v = params[patchStart + i]
              if (row) (row as Record<string, unknown>)[assigns[i]] = v
            }
          }
        }
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM belief_maintenance_state WHERE key = \?/i.test(sql.trim().replace(/\s+/g, ' '))) {
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT source_generation FROM belief_maintenance_state WHERE key = \?/i.test(sql.trim().replace(/\s+/g, ' '))) {
        return { rows: row ? [{ source_generation: row.source_generation }] : [], rowsAffected: 0 }
      }
      if (/^UPDATE belief_maintenance_state SET source_generation = source_generation \+ 1 WHERE key = \?/i.test(sql.trim().replace(/\s+/g, ' '))) {
        if (row != null) row.source_generation = Number(row.source_generation) + 1
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      throw new Error('unhandled SQL: ' + sql.trim().replace(/\s+/g, ' '))
    },
    async transaction(fn) { await fn(db) },
    close() {},
  }
  return { db, getRow: () => row, ops }
}

describe('storage/maintenance-state', () => {
  it('reads the seeded state (zeros + status idle) after migration 031', async () => {
    const { db } = createFakeDb()
    const res = await getMaintenanceState('belief', db)
    expect(res.success).toBe(true)
    expect(res.success && res.data).toMatchObject({
      key: 'belief',
      algorithm_version: 0,
      source_generation: 0,
      processed_generation: 0,
      status: 'idle',
      last_run_at: null,
      repaired_clusters: 0,
      deferred_clusters: 0,
      run_count: 0,
    })
  })

  it('returns a default state when the table/row is missing (unseeded test DB)', async () => {
    const { db } = createFakeDb(false)
    const res = await getMaintenanceState('belief', db)
    expect(res.success && res.data.source_generation).toBe(0)
    expect(res.success && res.data.status).toBe('idle')
  })

  it('patch updates only the columns the caller passes — no silent processed_generation bump', async () => {
    const { db } = createFakeDb()
    await updateMaintenanceState({ algorithm_version: 5, last_run_at: 9999 }, 'belief', db)
    const res = await getMaintenanceState('belief', db)
    // processed_generation is UNCHANGED — the runner captures source_generation
    // before analysis and only copies it to processed_generation after every
    // approved and deferred cluster settles. updateMaintenanceState never
    // silently bumps it.
    expect(res.success && res.data.algorithm_version).toBe(5)
    expect(res.success && res.data.processed_generation).toBe(0)
  })

  it('incrementSourceGeneration bumps by one and returns the new value', async () => {
    const { db } = createFakeDb()
    const a = await incrementSourceGeneration('belief', db)
    const b = await incrementSourceGeneration('belief', db)
    expect(a.success && a.data).toBe(1)
    expect(b.success && b.data).toBe(2)
  })

  it('incrementSourceGeneration seeds the row if missing (resilient harness)', async () => {
    const { db, getRow } = createFakeDb(false)
    expect(getRow()).toBeNull()
    const res = await incrementSourceGeneration('belief', db)
    expect(res.success && res.data).toBe(1)
    expect(getRow()?.source_generation).toBe(1)
  })

  it('status coerces unknown strings to idle (no malformed state)', async () => {
    const { db, getRow } = createFakeDb()
    // Simulate a corrupted row read.
    if (getRow()) (getRow() as Record<string, unknown>).status = 'zzz-bogus'
    const res = await getMaintenanceState('belief', db)
    expect(res.success && res.data.status).toBe('idle')
  })
})
