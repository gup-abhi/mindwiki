import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, type SqlParam, getDb } from './db'
import { enqueueUpsert } from './sync-queue'

export type PursuitStatus = 'active' | 'done' | 'abandoned' | 'dormant'

export interface Pursuit {
  id: string
  title: string
  details: string
  status: PursuitStatus
  checkin_question: string
  wiki_page_id: string | null
  created_at: number
  updated_at: number
  last_mentioned_at: number
  last_checkin_at: number | null
}

export interface NewPursuit {
  title: string
  details?: string
  wiki_page_id?: string | null
}

// Mutable fields. last_mentioned_at bumps when the pursuit resurfaces in an
// entry/chat; last_checkin_at stamps when a check-in is surfaced; status drives
// the lifecycle. Omit a field to leave it unchanged.
export interface PursuitPatch {
  title?: string
  details?: string
  status?: PursuitStatus
  checkin_question?: string
  wiki_page_id?: string | null
  last_mentioned_at?: number
  last_checkin_at?: number | null
}

const PATCH_COLUMNS = [
  'title',
  'details',
  'status',
  'checkin_question',
  'wiki_page_id',
  'last_mentioned_at',
  'last_checkin_at',
] as const

function rowToPursuit(row: Record<string, unknown>): Pursuit {
  return {
    id: String(row.id),
    title: String(row.title),
    details: String(row.details ?? ''),
    status: String(row.status ?? 'active') as PursuitStatus,
    checkin_question: String(row.checkin_question ?? ''),
    wiki_page_id: row.wiki_page_id == null ? null : String(row.wiki_page_id),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    last_mentioned_at: Number(row.last_mentioned_at),
    last_checkin_at: row.last_checkin_at == null ? null : Number(row.last_checkin_at),
  }
}

export async function createPursuit(
  input: NewPursuit,
  db: SqliteDatabase = getDb()
): Promise<Result<Pursuit>> {
  const now = Date.now()
  const pursuit: Pursuit = {
    id: randomUUID(),
    title: input.title,
    details: input.details ?? '',
    status: 'active',
    checkin_question: '',
    wiki_page_id: input.wiki_page_id ?? null,
    created_at: now,
    updated_at: now,
    last_mentioned_at: now,
    last_checkin_at: null,
  }
  try {
    await db.execute(
      `INSERT INTO pursuits
         (id, title, details, status, checkin_question, wiki_page_id,
          created_at, updated_at, last_mentioned_at, last_checkin_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pursuit.id, pursuit.title, pursuit.details, pursuit.status, pursuit.checkin_question,
        pursuit.wiki_page_id, now, now, now, null,
      ]
    )
    await enqueueUpsert('pursuits', pursuit.id, db) // best-effort; never blocks
    return ok(pursuit)
  } catch (e) {
    return err('PURSUIT_CREATE_FAILED', 'Failed to create pursuit', e)
  }
}

export async function getPursuit(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<Pursuit | null>> {
  try {
    const res = await db.execute('SELECT * FROM pursuits WHERE id = ?', [id])
    const row = res.rows[0]
    return ok(row ? rowToPursuit(row) : null)
  } catch (e) {
    return err('PURSUIT_GET_FAILED', 'Failed to read pursuit', e)
  }
}

/** Permanently remove a pursuit (local-only, mirrors deleteEntry). */
export async function deletePursuit(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute('DELETE FROM pursuits WHERE id = ?', [id])
    return ok(undefined)
  } catch (e) {
    return err('PURSUIT_DELETE_FAILED', 'Failed to delete pursuit', e)
  }
}

/** All pursuits, most-recently-mentioned first. */
export async function listPursuits(db: SqliteDatabase = getDb()): Promise<Result<Pursuit[]>> {
  try {
    const res = await db.execute('SELECT * FROM pursuits ORDER BY last_mentioned_at DESC')
    return ok(res.rows.map(rowToPursuit))
  } catch (e) {
    return err('PURSUIT_LIST_FAILED', 'Failed to list pursuits', e)
  }
}

/**
 * Apply a partial update to the mutable fields, bumping updated_at (and
 * re-enqueuing for sync). Returns the updated pursuit, or PURSUIT_NOT_FOUND if
 * no row matched. Column names come from a fixed allowlist — values are bound.
 */
export async function updatePursuit(
  id: string,
  patch: PursuitPatch,
  db: SqliteDatabase = getDb()
): Promise<Result<Pursuit>> {
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
    const res = await db.execute(`UPDATE pursuits SET ${sets.join(', ')} WHERE id = ?`, params)
    if ((res.rowsAffected ?? 0) === 0) return err('PURSUIT_NOT_FOUND', 'Pursuit not found')
    await enqueueUpsert('pursuits', id, db)
    const got = await getPursuit(id, db)
    if (!got.success) return got
    if (got.data == null) return err('PURSUIT_NOT_FOUND', 'Pursuit not found')
    return ok(got.data)
  } catch (e) {
    return err('PURSUIT_UPDATE_FAILED', 'Failed to update pursuit', e)
  }
}
