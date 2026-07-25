import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'

// F-02C — persisted state for the idempotent belief-maintenance pass. The pass
// is restart-safe and rerun-gated: it runs only when the embedding model is
// available AND when algorithm_version has changed OR source_generation >
// processed_generation. The maintenance pass INCREMENTS source_generation
// directly (NOT via these helpers) when it observes a raw belief/reframe
// ingestion or a remote apply — but the maintenance's own rewrites never
// re-increment, so a quiet base cannot self-trigger.
//
// State records count-only metadata + an opaque algorithm_version. Never label
// text, never label-derived hashes: a future inverted-geometry tuning can
// bump algorithm_version to force one rerun, but no belief content lives here.

/** Aggregate keys we may eventually maintain (today: belief only). */
export type MaintenanceKey = 'belief'

export interface BeliefMaintenanceState {
  key: MaintenanceKey
  algorithm_version: number
  source_generation: number
  processed_generation: number
  status: 'idle' | 'dry-run' | 'repairing' | 'needs-graph-rebuild' | 'error'
  last_run_at: number | null
  repaired_clusters: number
  deferred_clusters: number
  consolidated_clusters: number
  run_count: number
}

function rowToState(row: Record<string, unknown>): BeliefMaintenanceState {
  const status = String(row.status ?? 'idle')
  return {
    key: 'belief',
    algorithm_version: Number(row.algorithm_version) || 0,
    source_generation: Number(row.source_generation) || 0,
    processed_generation: Number(row.processed_generation) || 0,
    status:
      status === 'dry-run' || status === 'repairing' || status === 'needs-graph-rebuild' || status === 'error'
        ? status
        : 'idle',
    last_run_at: row.last_run_at == null ? null : Number(row.last_run_at),
    repaired_clusters: Number(row.repaired_clusters) || 0,
    deferred_clusters: Number(row.deferred_clusters) || 0,
    consolidated_clusters: Number(row.consolidated_clusters) || 0,
    run_count: Number(row.run_count) || 0,
  }
}

/** Read the belief-maintenance state row. Always exists after migration 031
 *  (the migration seeds the row), but older DBs / tests may lack it — return
 *  the default. Never throws. */
export async function getMaintenanceState(
  key: MaintenanceKey = 'belief',
  db: SqliteDatabase = getDb()
): Promise<Result<BeliefMaintenanceState>> {
  try {
    const res = await db.execute(
      'SELECT * FROM belief_maintenance_state WHERE key = ?',
      [key]
    )
    const row = res.rows[0]
    if (!row) {
      return ok({
        key,
        algorithm_version: 0,
        source_generation: 0,
        processed_generation: 0,
        status: 'idle',
        last_run_at: null,
        repaired_clusters: 0,
        deferred_clusters: 0,
        consolidated_clusters: 0,
        run_count: 0,
      })
    }
    return ok(rowToState(row))
  } catch (e) {
    return err('MAINTENANCE_STATE_READ_FAILED', 'Failed to read maintenance state', e)
  }
}

type StatePatch = Partial<
  Pick<
    BeliefMaintenanceState,
    | 'algorithm_version'
    | 'source_generation'
    | 'processed_generation'
    | 'status'
    | 'last_run_at'
    | 'repaired_clusters'
    | 'deferred_clusters'
    | 'consolidated_clusters'
    | 'run_count'
  >
>

/** Patch specific columns of the belief-maintenance state row. Caller controls
 *  exactly what is mutated — the helpers below do not silently bump
 *  processed_generation; the maintenance runner captures source_generation
 *  before analysis and only copies it to processed_generation after every
 *  approved and deferred cluster settles. */
export async function updateMaintenanceState(
  patch: StatePatch,
  key: MaintenanceKey = 'belief',
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  const updates: string[] = []
  const params: unknown[] = []
  const fields: (keyof StatePatch)[] = [
    'algorithm_version',
    'source_generation',
    'processed_generation',
    'status',
    'last_run_at',
    'repaired_clusters',
    'deferred_clusters',
    'consolidated_clusters',
    'run_count',
  ]
  for (const f of fields) {
    if (patch[f] !== undefined) {
      updates.push(`${f} = ?`)
      params.push(patch[f])
    }
  }
  if (updates.length === 0) return ok(undefined)
  try {
    // Upsert — the seeded row may have been deleted by a stripped-down test DB;
    // recreate it on write so maintenance state survives partial test harnesses.
    const vals: unknown[] = [key]
    for (const f of fields) vals.push(patch[f] ?? null)
    const execParams: unknown[] = [...vals, ...params]
    await db.execute(
      `INSERT INTO belief_maintenance_state
         (key, ${fields.map((f) => f).join(', ')})
       VALUES (?, ${fields.map(() => '?').join(', ')})
       ON CONFLICT(key) DO UPDATE SET ${updates.join(', ')}`,
      execParams as (string | number | null)[]
    )
    return ok(undefined)
  } catch (e) {
    return err('MAINTENANCE_STATE_WRITE_FAILED', 'Failed to write maintenance state', e)
  }
}

/**
 * Increment source_generation for the given maintenance pass; atomically.
 * Called by raw belief/reframe ingestion paths and by remote-apply handlers —
 * never by the maintenance pass itself (its own rewrites do not bump, which
 * is what prevents self-trigger loops). Returns the new source_generation or
 * an error.
 */
export async function incrementSourceGeneration(
  key: MaintenanceKey = 'belief',
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    // UPSERT then read-back so the seeded row is created if missing.
    await db.execute(
      `INSERT INTO belief_maintenance_state (key, source_generation)
         VALUES ('belief', 0)
         ON CONFLICT(key) DO NOTHING`,
      []
    )
    await db.execute(
      `UPDATE belief_maintenance_state
         SET source_generation = source_generation + 1
         WHERE key = ?`,
      [key]
    )
    const res = await db.execute(
      'SELECT source_generation FROM belief_maintenance_state WHERE key = ?',
      [key]
    )
    const row = res.rows[0]
    if (!row) return err('MAINTENANCE_STATE_READ_FAILED', 'Failed to read maintenance state')
    return ok(Number(row.source_generation) || 0)
  } catch (e) {
    return err('MAINTENANCE_STATE_WRITE_FAILED', 'Failed to increment source generation', e)
  }
}
