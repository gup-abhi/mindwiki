import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsert } from './sync-queue'

// A user-authored CBT thought-record challenging a recurring belief. Keyed by the
// belief `label` (its stable identity — shared by the belief graph node + wiki
// page), so reframes follow the belief even as the graph is rebuilt.
export interface BeliefReframe {
  id: string
  belief: string
  evidence_for: string
  evidence_against: string
  balanced_thought: string
  created_at: number
  updated_at: number
}

export interface NewReframe {
  belief: string
  evidence_for?: string
  evidence_against?: string
  balanced_thought: string
}

function rowToReframe(row: Record<string, unknown>): BeliefReframe {
  return {
    id: String(row.id),
    belief: String(row.belief),
    evidence_for: String(row.evidence_for ?? ''),
    evidence_against: String(row.evidence_against ?? ''),
    balanced_thought: String(row.balanced_thought ?? ''),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }
}

/**
 * Save a reframe for a belief and enqueue it for E2E sync. Best-effort enqueue —
 * a queue failure never fails the write (the row is local; sync retries later).
 */
export async function createReframe(
  input: NewReframe,
  db: SqliteDatabase = getDb()
): Promise<Result<BeliefReframe>> {
  const now = Date.now()
  const reframe: BeliefReframe = {
    id: randomUUID(),
    belief: input.belief.trim(),
    evidence_for: input.evidence_for?.trim() ?? '',
    evidence_against: input.evidence_against?.trim() ?? '',
    balanced_thought: input.balanced_thought.trim(),
    created_at: now,
    updated_at: now,
  }
  try {
    await db.execute(
      `INSERT INTO belief_reframes
         (id, belief, evidence_for, evidence_against, balanced_thought, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        reframe.id,
        reframe.belief,
        reframe.evidence_for,
        reframe.evidence_against,
        reframe.balanced_thought,
        now,
        now,
      ]
    )
    await enqueueUpsert('belief_reframes', reframe.id, db)
    return ok(reframe)
  } catch (e) {
    return err('REFRAME_CREATE_FAILED', 'Failed to save reframe', e)
  }
}

/** Reframes the user has written for a belief (case-insensitive), newest first. */
export async function listReframesForBelief(
  belief: string,
  db: SqliteDatabase = getDb()
): Promise<Result<BeliefReframe[]>> {
  try {
    const res = await db.execute(
      'SELECT * FROM belief_reframes WHERE belief = ? COLLATE NOCASE ORDER BY created_at DESC',
      [belief.trim()]
    )
    return ok(res.rows.map(rowToReframe))
  } catch (e) {
    return err('REFRAME_LIST_FAILED', 'Failed to list reframes', e)
  }
}
