import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsertInTransaction, notifySyncPending } from './sync-queue'
import { incrementSourceGeneration } from './maintenance-state'

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
    await db.transaction(async (tx) => {
      await tx.execute(
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
      await enqueueUpsertInTransaction('belief_reframes', reframe.id, tx)
      const bump = await incrementSourceGeneration('belief', tx)
      if (!bump.success) throw new Error(bump.error.code)
    })
    notifySyncPending()
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

/** F-02C — retarget every reframe keyed under `fromRaw` (case-insensitive) to
 *  `toCanonical`, bump LWW watermark, and enqueue each changed row. Used ONLY
 *  by the historical belief-maintenance pass when a raw alias retires under a
 *  chosen canonical identity. NEVER bumps the maintenance source generation
 *  (maintenance's own writes do not self-increment — that's what prevents a
 *  self-trigger loop). Returns the number of reframes retargeted. */
export async function retargetReframeBelief(
  fromRaw: string,
  toCanonical: string,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  const canon = toCanonical.trim()
  if (!canon) return err('REFRAME_RETARGET_INVALID', 'canonical label must be non-empty')
  try {
    let n = 0
    await db.transaction(async (tx) => {
      const now = Date.now()
      const oldRows = await tx.execute(
        'SELECT id FROM belief_reframes WHERE belief = ? COLLATE NOCASE',
        [fromRaw.trim()]
      )
      const ids = oldRows.rows.map((r) => String(r.id))
      const upd = await tx.execute(
        'UPDATE belief_reframes SET belief = ?, updated_at = ? WHERE belief = ? COLLATE NOCASE',
        [canon, now, fromRaw.trim()]
      )
      n = Number(upd.rowsAffected ?? 0)
      for (const id of ids) await enqueueUpsertInTransaction('belief_reframes', id, tx)
    })
    if (n > 0) notifySyncPending()
    return ok(n)
  } catch (e) {
    return err('REFRAME_RETARGET_FAILED', 'Failed to retarget reframes', e)
  }
}
