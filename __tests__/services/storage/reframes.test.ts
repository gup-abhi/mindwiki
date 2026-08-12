import { type SqliteDatabase } from '@/services/storage/db'
import { createReframe, listReframesForBelief, retargetReframeBelief } from '@/services/storage/reframes'
import { enqueueUpsert, enqueueUpsertInTransaction } from '@/services/storage/sync-queue'

let mockUuidCounter = 0
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockUuidCounter}`,
}))

jest.mock('@/services/storage/sync-queue', () => ({
  enqueueUpsert: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
  enqueueUpsertInTransaction: jest.fn(() => Promise.resolve()),
  notifySyncPending: jest.fn(),
}))
const mockEnqueue = enqueueUpsert as jest.Mock
const mockEnqueueInTransaction = jest.requireMock('@/services/storage/sync-queue').enqueueUpsertInTransaction as jest.Mock

// In-memory fake backing the exact queries reframes.ts issues.
function createFakeDb() {
  const rows = new Map<string, Record<string, unknown>>()
  let sourceGeneration = 0
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^INSERT INTO belief_maintenance_state/.test(sql)) {
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE belief_maintenance_state/.test(sql)) {
        sourceGeneration += 1
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT source_generation FROM belief_maintenance_state/.test(sql)) {
        return { rows: [{ source_generation: sourceGeneration }], rowsAffected: 0 }
      }
      if (/^INSERT INTO belief_reframes/.test(sql)) {
        const [id, belief, evidence_for, evidence_against, balanced_thought, created_at, updated_at] = params
        rows.set(String(id), { id, belief, evidence_for, evidence_against, balanced_thought, created_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM belief_reframes WHERE belief = \? COLLATE NOCASE ORDER BY created_at DESC/.test(sql)) {
        const belief = String(params[0]).toLowerCase()
        const all = [...rows.values()]
          .filter((r) => String(r.belief).toLowerCase() === belief)
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        return { rows: all, rowsAffected: 0 }
      }
      if (/^SELECT id FROM belief_reframes WHERE belief = \? COLLATE NOCASE AND belief <> \? COLLATE NOCASE/.test(sql)) {
        const from = String(params[0]).toLowerCase()
        const canonical = String(params[1]).toLowerCase()
        return {
          rows: [...rows.values()]
            .filter((r) => String(r.belief).toLowerCase() === from && String(r.belief).toLowerCase() !== canonical)
            .map((r) => ({ id: r.id })),
          rowsAffected: 0,
        }
      }
      if (/^UPDATE belief_reframes SET belief = \?, updated_at = MAX/.test(sql)) {
        const [canonical, now, from] = params
        let changed = 0
        for (const row of rows.values()) {
          if (String(row.belief).toLowerCase() !== String(from).toLowerCase() || String(row.belief).toLowerCase() === String(canonical).toLowerCase()) continue
          row.belief = canonical
          row.updated_at = Math.max(Number(row.updated_at) + 1, Number(now))
          changed++
        }
        return { rows: [], rowsAffected: changed }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, rows }
}

describe('storage/reframes', () => {
  beforeEach(() => {
    mockUuidCounter = 0
    mockEnqueue.mockClear()
  })

  it('saves a reframe, trims fields, and enqueues it for sync', async () => {
    const { db } = createFakeDb()
    const res = await createReframe(
      {
        belief: '  I am not good enough  ',
        evidence_for: '  I froze in the meeting ',
        evidence_against: ' I shipped the feature ',
        balanced_thought: '  I can be nervous and still capable.  ',
      },
      db
    )

    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.belief).toBe('I am not good enough')
      expect(res.data.balanced_thought).toBe('I can be nervous and still capable.')
      expect(res.data.evidence_for).toBe('I froze in the meeting')
    }
    expect(mockEnqueueInTransaction).toHaveBeenCalledWith('belief_reframes', 'uuid-1', db)
  })

  it('lists reframes for a belief (case-insensitive), newest first', async () => {
    const { db, rows } = createFakeDb()
    const a = await createReframe({ belief: 'I am a failure', balanced_thought: 'first' }, db)
    const b = await createReframe({ belief: 'I am a failure', balanced_thought: 'second' }, db)
    await createReframe({ belief: 'Other belief', balanced_thought: 'unrelated' }, db)
    // pin order deterministically (createReframe uses Date.now())
    if (a.success) rows.get(a.data.id)!.created_at = 100
    if (b.success) rows.get(b.data.id)!.created_at = 200

    const res = await listReframesForBelief('i am a failure', db)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.map((r) => r.balanced_thought)).toEqual(['second', 'first'])
    }
  })

  it('retarget is monotonic and idempotent', async () => {
    const { db, rows } = createFakeDb()
    jest.spyOn(Date, 'now').mockReturnValue(2000)
    const created = await createReframe({ belief: 'Alias', balanced_thought: 'balanced' }, db)
    if (!created.success) throw new Error('setup failed')
    jest.spyOn(Date, 'now').mockReturnValue(1000)
    mockEnqueueInTransaction.mockClear()

    const first = await retargetReframeBelief('Alias', 'Canonical', db)
    expect(first.success && first.data).toBe(1)
    expect(rows.get(created.data.id)?.updated_at).toBe(2001)
    expect(mockEnqueueInTransaction).toHaveBeenCalledTimes(1)

    mockEnqueueInTransaction.mockClear()
    const second = await retargetReframeBelief('Alias', 'Canonical', db)
    jest.restoreAllMocks()
    expect(second.success && second.data).toBe(0)
    expect(mockEnqueueInTransaction).not.toHaveBeenCalled()
  })

  it('defaults evidence fields to empty when omitted', async () => {
    const { db } = createFakeDb()
    const res = await createReframe({ belief: 'X', balanced_thought: 'a balanced thought' }, db)
    expect(res.success && res.data.evidence_for).toBe('')
    expect(res.success && res.data.evidence_against).toBe('')
  })
})
