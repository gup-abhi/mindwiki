import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsert } from './sync-queue'

// Concrete entities pulled from an entry by the fast model. A subset of the
// graph NodeType union (see services/storage/graph.ts).
export type EntityType = 'person' | 'place' | 'activity'

export interface EntryEntity {
  id: string
  entry_id: string
  type: EntityType
  label: string
  created_at: number
}

/** A type+label pair to attach to an entry (id/created_at are assigned here). */
export interface NewEntity {
  type: EntityType
  label: string
}

function rowToEntity(row: Record<string, unknown>): EntryEntity {
  return {
    id: String(row.id),
    entry_id: String(row.entry_id),
    type: String(row.type) as EntityType,
    label: String(row.label),
    created_at: Number(row.created_at),
  }
}

// Deterministic id so re-tagging an entry collapses to the same rows (and the
// same sync records) instead of duplicating.
function entityId(entryId: string, type: EntityType, label: string): string {
  return `${entryId}:${type}:${label.toLowerCase()}`
}

/**
 * Replace the set of entities attached to an entry (delete-then-insert in one
 * transaction) and enqueue each for E2E sync. Best-effort enqueue — a queue
 * failure never fails the write (the row is local; sync just retries later).
 */
export async function setEntitiesForEntry(
  entryId: string,
  entities: NewEntity[],
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  const now = Date.now()
  // Dedupe by (type, lowercased label) so a deterministic id never collides
  // inside one entry.
  const seen = new Set<string>()
  const rows: EntryEntity[] = []
  for (const e of entities) {
    const label = e.label.trim()
    if (!label) continue
    const key = `${e.type}:${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ id: entityId(entryId, e.type, label), entry_id: entryId, type: e.type, label, created_at: now })
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM entry_entities WHERE entry_id = ?', [entryId])
      for (const r of rows) {
        await tx.execute(
          'INSERT INTO entry_entities (id, entry_id, type, label, created_at) VALUES (?, ?, ?, ?, ?)',
          [r.id, r.entry_id, r.type, r.label, r.created_at]
        )
      }
    })
    for (const r of rows) await enqueueUpsert('entry_entities', r.id, db)
    return ok(undefined)
  } catch (e) {
    return err('ENTITY_SET_FAILED', 'Failed to set entry entities', e)
  }
}

/** Entities attached to a single entry (used by the graph builder/rebuild). */
export async function listEntitiesForEntry(
  entryId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<EntryEntity[]>> {
  try {
    const res = await db.execute('SELECT * FROM entry_entities WHERE entry_id = ?', [entryId])
    return ok(res.rows.map(rowToEntity))
  } catch (e) {
    return err('ENTITY_LIST_FAILED', 'Failed to list entry entities', e)
  }
}

/** Number of distinct entries that mention an entity — the wiki recurrence gate. */
export async function countEntriesForEntity(
  type: EntityType,
  label: string,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    const res = await db.execute(
      'SELECT COUNT(DISTINCT entry_id) AS n FROM entry_entities WHERE type = ? AND label = ? COLLATE NOCASE',
      [type, label]
    )
    return ok(Number(res.rows[0]?.n ?? 0))
  } catch (e) {
    return err('ENTITY_COUNT_FAILED', 'Failed to count entity entries', e)
  }
}
