import { type SqliteDatabase } from '@/services/storage/db'
import {
  createChallenge,
  deleteChallenge,
  getActiveChallenge,
  getChallenge,
  listChallenges,
  updateChallenge,
} from '@/services/storage/challenges'

let mockUuidCounter = 0
jest.mock('expo-crypto', () => ({
  randomUUID: () => `id-${++mockUuidCounter}`,
}))

// In-memory fake backing the exact queries challenges.ts issues. sync_queue
// inserts are intentionally unhandled — enqueueUpsert swallows the error.
function createFakeDb() {
  const challenges = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^INSERT INTO challenges/.test(sql)) {
        const [id, title, details, target_days, current_streak, last_checkin_date,
          status, affirmation, created_at, updated_at, completed_at] = params
        challenges.set(String(id), {
          id, title, details, target_days, current_streak, last_checkin_date,
          status, affirmation, created_at, updated_at, completed_at,
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM challenges WHERE id/.test(sql)) {
        const row = challenges.get(String(params[0]))
        const visible = row && row.deleted_at == null
        return { rows: visible ? [row] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM challenges WHERE status = 'active'/.test(sql)) {
        const rows = [...challenges.values()]
          .filter((c) => c.status === 'active' && c.deleted_at == null)
          .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
        return { rows: rows.slice(0, 1), rowsAffected: 0 }
      }
      if (/^SELECT \* FROM challenges WHERE deleted_at IS NULL ORDER BY updated_at/.test(sql)) {
        const rows = [...challenges.values()]
          .filter((c) => c.deleted_at == null)
          .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
        return { rows, rowsAffected: 0 }
      }
      if (/^DELETE FROM challenges WHERE id/.test(sql)) {
        // Legacy handler — deleteChallenge now tombstones via UPDATE; kept dead
        // so a regression to hard DELETE is caught by the SQL matcher.
        const existed = challenges.delete(String(params[0]))
        return { rows: [], rowsAffected: existed ? 1 : 0 }
      }
      if (/^UPDATE challenges SET /.test(sql)) {
        const setPart = sql.slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE'))
        const cols = setPart.split(',').map((s) => s.trim().split(' ')[0])
        const id = params[params.length - 1]
        const row = challenges.get(String(id))
        if (row) cols.forEach((c, i) => { row[c] = params[i] })
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

describe('storage/challenges CRUD', () => {
  beforeEach(() => {
    mockUuidCounter = 0
  })

  it('creates a challenge with active defaults and reads it back', async () => {
    const { db } = createFakeDb()
    const created = await createChallenge({ title: 'Work out every day' }, db)
    expect(created.success).toBe(true)
    if (!created.success) return

    expect(created.data.status).toBe('active')
    expect(created.data.target_days).toBe(30)
    expect(created.data.current_streak).toBe(0)
    expect(created.data.last_checkin_date).toBe('')
    expect(created.data.affirmation).toBe('')
    expect(created.data.completed_at).toBeNull()

    const got = await getChallenge(created.data.id, db)
    expect(got.success && got.data?.title).toBe('Work out every day')

    const missing = await getChallenge('nope', db)
    expect(missing.success && missing.data).toBeNull()
  })

  it('honours a custom target_days and details', async () => {
    const { db } = createFakeDb()
    const created = await createChallenge(
      { title: 'Read', details: '20 pages', target_days: 21 },
      db
    )
    if (!created.success) throw new Error('setup failed')
    expect(created.data.target_days).toBe(21)
    expect(created.data.details).toBe('20 pages')
  })

  it('returns the most-recently-updated active challenge, ignoring completed ones', async () => {
    const { db } = createFakeDb()
    const a = await createChallenge({ title: 'A' }, db)
    const b = await createChallenge({ title: 'B' }, db)
    if (!a.success || !b.success) throw new Error('setup failed')

    // A is completed; only B should be returned as active.
    await updateChallenge(a.data.id, { status: 'completed' }, db)

    const active = await getActiveChallenge(db)
    expect(active.success).toBe(true)
    if (active.success) expect(active.data?.title).toBe('B')
  })

  it('returns null active challenge when none are active', async () => {
    const { db } = createFakeDb()
    const c = await createChallenge({ title: 'Solo' }, db)
    if (!c.success) throw new Error('setup failed')
    await updateChallenge(c.data.id, { status: 'completed' }, db)

    const active = await getActiveChallenge(db)
    expect(active.success && active.data).toBeNull()
  })

  it('lists all challenges most-recently-updated first', async () => {
    const { db } = createFakeDb()
    const a = await createChallenge({ title: 'A' }, db)
    const b = await createChallenge({ title: 'B' }, db)
    if (!a.success || !b.success) throw new Error('setup failed')

    await updateChallenge(b.data.id, { current_streak: 1 }, db)
    await updateChallenge(a.data.id, { current_streak: 1 }, db)

    const list = await listChallenges(db)
    expect(list.success).toBe(true)
    if (list.success) expect(list.data.map((c) => c.title)).toEqual(['A', 'B'])
  })

  it('patches only the supplied fields', async () => {
    const { db } = createFakeDb()
    const created = await createChallenge({ title: 'Meditate' }, db)
    if (!created.success) throw new Error('setup failed')

    const updated = await updateChallenge(
      created.data.id,
      { current_streak: 5, last_checkin_date: '2026-06-13', status: 'completed', affirmation: 'I show up.', completed_at: 9000 },
      db
    )
    expect(updated.success).toBe(true)
    if (updated.success) {
      expect(updated.data.current_streak).toBe(5)
      expect(updated.data.last_checkin_date).toBe('2026-06-13')
      expect(updated.data.status).toBe('completed')
      expect(updated.data.affirmation).toBe('I show up.')
      expect(updated.data.completed_at).toBe(9000)
      // untouched fields keep their values
      expect(updated.data.title).toBe('Meditate')
      expect(updated.data.target_days).toBe(30)
    }
  })

  it('returns CHALLENGE_NOT_FOUND when updating a missing row', async () => {
    const { db } = createFakeDb()
    const res = await updateChallenge('ghost', { current_streak: 1 }, db)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('CHALLENGE_NOT_FOUND')
  })

  it('deletes a challenge via a syncable tombstone instead of a local row drop', async () => {
    const { db } = createFakeDb()
    const created = await createChallenge({ title: 'Temp' }, db)
    if (!created.success) throw new Error('setup failed')

    const del = await deleteChallenge(created.data.id, db)
    expect(del.success).toBe(true)

    // The row survives (it must sync as a tombstone), but every read hides it.
    const got = await getChallenge(created.data.id, db)
    expect(got.success && got.data).toBeNull()
    const list = await listChallenges(db)
    expect(list.success && list.data.length).toBe(0)
    const active = await getActiveChallenge(db)
    expect(active.success && active.data).toBeNull()
  })

  it('hides a challenge tombstoned by a remote device after the row lands locally', async () => {
    const { db } = createFakeDb()
    // Simulates a synced row: INSERT OR REPLACE carries deleted_at verbatim.
    const created = await createChallenge({ title: 'Remote' }, db)
    if (!created.success) throw new Error('setup failed')
    await db.execute('UPDATE challenges SET deleted_at = ? WHERE id = ?', [Date.now(), created.data.id])

    const got = await getChallenge(created.data.id, db)
    expect(got.success && got.data).toBeNull()
    const active = await getActiveChallenge(db)
    expect(active.success && active.data).toBeNull()
  })

  it('refuses to update a deleted challenge (CHALLENGE_NOT_FOUND)', async () => {
    const { db } = createFakeDb()
    const created = await createChallenge({ title: 'Gone' }, db)
    if (!created.success) throw new Error('setup failed')
    await deleteChallenge(created.data.id, db)

    const res = await updateChallenge(created.data.id, { current_streak: 1 }, db)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('CHALLENGE_NOT_FOUND')
  })
})
