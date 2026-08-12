import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, type SqlParam, getDb } from './db'
import { enqueueUpsertInTransaction, notifySyncPending } from './sync-queue'

export type ChallengeStatus = 'active' | 'completed'

export interface Challenge {
  id: string
  title: string
  details: string
  target_days: number
  current_streak: number
  /** Local 'YYYY-MM-DD' of the last day the user checked in; '' if never. */
  last_checkin_date: string
  status: ChallengeStatus
  affirmation: string
  created_at: number
  updated_at: number
  completed_at: number | null
}

export interface NewChallenge {
  title: string
  details?: string
  target_days?: number
}

// Mutable fields. The streak/reset/completion machinery (Phase 2) drives
// current_streak, last_checkin_date, status, affirmation and completed_at via
// this patch. Omit a field to leave it unchanged.
export interface ChallengePatch {
  title?: string
  details?: string
  target_days?: number
  current_streak?: number
  last_checkin_date?: string
  status?: ChallengeStatus
  affirmation?: string
  completed_at?: number | null
}

const DEFAULT_TARGET_DAYS = 30

const PATCH_COLUMNS = [
  'title',
  'details',
  'target_days',
  'current_streak',
  'last_checkin_date',
  'status',
  'affirmation',
  'completed_at',
] as const

function rowToChallenge(row: Record<string, unknown>): Challenge {
  return {
    id: String(row.id),
    title: String(row.title),
    details: String(row.details ?? ''),
    target_days: Number(row.target_days),
    current_streak: Number(row.current_streak),
    last_checkin_date: String(row.last_checkin_date ?? ''),
    status: String(row.status ?? 'active') as ChallengeStatus,
    affirmation: String(row.affirmation ?? ''),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    completed_at: row.completed_at == null ? null : Number(row.completed_at),
  }
}

export async function createChallenge(
  input: NewChallenge,
  db: SqliteDatabase = getDb()
): Promise<Result<Challenge>> {
  const now = Date.now()
  const challenge: Challenge = {
    id: randomUUID(),
    title: input.title,
    details: input.details ?? '',
    target_days: input.target_days ?? DEFAULT_TARGET_DAYS,
    current_streak: 0,
    last_checkin_date: '',
    status: 'active',
    affirmation: '',
    created_at: now,
    updated_at: now,
    completed_at: null,
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO challenges
           (id, title, details, target_days, current_streak, last_checkin_date,
            status, affirmation, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          challenge.id, challenge.title, challenge.details, challenge.target_days,
          challenge.current_streak, challenge.last_checkin_date, challenge.status,
          challenge.affirmation, now, now, null,
        ]
      )
      await enqueueUpsertInTransaction('challenges', challenge.id, tx)
    })
    notifySyncPending()
    return ok(challenge)
  } catch (e) {
    return err('CHALLENGE_CREATE_FAILED', 'Failed to create challenge', e)
  }
}

export async function getChallenge(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<Challenge | null>> {
  try {
    const res = await db.execute('SELECT * FROM challenges WHERE id = ? AND deleted_at IS NULL', [id])
    const row = res.rows[0]
    return ok(row ? rowToChallenge(row) : null)
  } catch (e) {
    return err('CHALLENGE_GET_FAILED', 'Failed to read challenge', e)
  }
}

/**
 * The current active challenge, or null. Only one challenge is active at a time
 * (the UI enforces this), so the most recently updated active row wins.
 */
export async function getActiveChallenge(
  db: SqliteDatabase = getDb()
): Promise<Result<Challenge | null>> {
  try {
    const res = await db.execute(
      `SELECT * FROM challenges WHERE status = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`
    )
    const row = res.rows[0]
    return ok(row ? rowToChallenge(row) : null)
  } catch (e) {
    return err('CHALLENGE_GET_FAILED', 'Failed to read active challenge', e)
  }
}

/** All challenges, most-recently-updated first (active + completed history). */
export async function listChallenges(
  db: SqliteDatabase = getDb()
): Promise<Result<Challenge[]>> {
  try {
    const res = await db.execute('SELECT * FROM challenges WHERE deleted_at IS NULL ORDER BY updated_at DESC')
    return ok(res.rows.map(rowToChallenge))
  } catch (e) {
    return err('CHALLENGE_LIST_FAILED', 'Failed to list challenges', e)
  }
}

/**
 * Permanently remove a challenge. Tombstone (deleted_at + updated_at bump) so
 * the removal syncs to other devices via the existing upsert protocol instead
 * of a local-only row drop that would resurrect on the next pull/restore.
 */
export async function deleteChallenge(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    let changed = false
    await db.transaction(async (tx) => {
      const now = Date.now()
      const res = await tx.execute(
        'UPDATE challenges SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [now, now, id]
      )
      changed = (res.rowsAffected ?? 0) > 0
      if (changed) await enqueueUpsertInTransaction('challenges', id, tx)
    })
    if (changed) notifySyncPending()
    return ok(undefined)
  } catch (e) {
    return err('CHALLENGE_DELETE_FAILED', 'Failed to delete challenge', e)
  }
}

/**
 * Apply a partial update to the mutable fields, bumping updated_at (and
 * re-enqueuing for sync). Returns the updated challenge, or CHALLENGE_NOT_FOUND
 * if no row matched. Column names come from a fixed allowlist — values are bound.
 */
export async function updateChallenge(
  id: string,
  patch: ChallengePatch,
  db: SqliteDatabase = getDb()
): Promise<Result<Challenge>> {
  const sets: string[] = []
  const params: SqlParam[] = []
  for (const col of PATCH_COLUMNS) {
    const value = patch[col]
    if (value !== undefined) {
      sets.push(`${col} = ?`)
      params.push(value as SqlParam)
    }
  }
  const now = Date.now()
  sets.push('updated_at = ?')
  params.push(now)
  params.push(id)

  try {
    let updated: Challenge | null = null
    await db.transaction(async (tx) => {
      const res = await tx.execute(`UPDATE challenges SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params)
      if ((res.rowsAffected ?? 0) === 0) throw new Error('CHALLENGE_NOT_FOUND')
      await enqueueUpsertInTransaction('challenges', id, tx)
      const got = await getChallenge(id, tx)
      if (!got.success) throw new Error(got.error.code)
      if (got.data == null) throw new Error('CHALLENGE_NOT_FOUND')
      updated = got.data
    })
    notifySyncPending()
    if (!updated) return err('CHALLENGE_NOT_FOUND', 'Challenge not found')
    return ok(updated)
  } catch (e) {
    if (e instanceof Error && e.message === 'CHALLENGE_NOT_FOUND') return err('CHALLENGE_NOT_FOUND', 'Challenge not found')
    return err('CHALLENGE_UPDATE_FAILED', 'Failed to update challenge', e)
  }
}
