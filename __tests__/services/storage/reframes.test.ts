import { type SqliteDatabase } from '@/services/storage/db'
import { createReframe, listReframesForBelief } from '@/services/storage/reframes'
import { enqueueUpsert } from '@/services/storage/sync-queue'

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
  const maintenance = { source_generation: 0 }
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      sql = sql.trim().replace(/\s+/g, ' ')
      if (/^INSERT INTO belief_reframes/.test(sql)) {
        const [id, belief, evidence_for, evidence_against, balanced_thought, created_at, updated_at] = params
        rows.set(String(id), { id, belief, evidence_for, evidence_against, balanced_thought, created_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^INSERT INTO belief_maintenance_state \(key, source_generation\)/.test(sql)) {
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE belief_maintenance_state SET source_generation = source_generation \+ 1/.test(sql)) {
        maintenance.source_generation += 1
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT source_generation FROM belief_maintenance_state/.test(sql)) {
        return { rows: [{ source_generation: maintenance.source_generation }], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM belief_reframes WHERE belief = \? COLLATE NOCASE ORDER BY created_at DESC/.test(sql)) {
        const belief = String(params[0]).toLowerCase()
        const all = [...rows.values()]
          .filter((r) => String(r.belief).toLowerCase() === belief)
          .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        return { rows: all, rowsAffected: 0 }
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
    expect(mockEnqueueInTransaction).toHaveBeenCalledWith('belief_reframes', 'uuid-1', expect.anything())
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

  it('defaults evidence fields to empty when omitted', async () => {
    const { db } = createFakeDb()
    const res = await createReframe({ belief: 'X', balanced_thought: 'a balanced thought' }, db)
    expect(res.success && res.data.evidence_for).toBe('')
    expect(res.success && res.data.evidence_against).toBe('')
  })
})
