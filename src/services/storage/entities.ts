import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsertInTransaction, notifySyncPending } from './sync-queue'
import { incrementSourceGeneration } from './maintenance-state'

// Signals pulled from an entry by the deep model. A subset of the graph NodeType
// union (see services/storage/graph.ts): concrete entities (person/place/
// activity) plus the cognitive signals (belief/behavior) — all share this
// type+label+entry_id shape and the recurrence/graph machinery.
export type EntityType = 'person' | 'place' | 'activity' | 'belief' | 'behavior'

export interface EntryEntity {
  id: string
  entry_id: string
  type: EntityType
  label: string
  created_at: number
  /** F-02B — null when this raw label is its own canonical identity; otherwise
   *  the trimmed canonical label this alias was snapped to. Never user-authored
   *  text on a fresh row; set by belief maintenance (F-02C) and propagated by sync. */
  canonical_label: string | null
  /** F-02B — mutable LWW watermark. bumped on canonicalization so a relabel
   *  reaches other devices. Backfilled from created_at by migration 030. */
  updated_at: number
}

/** A type+label pair to attach to an entry (id/created_at are assigned here). */
export interface NewEntity {
  type: EntityType
  label: string
}

/** F-02B — the effective identity of an entity: the trimmed canonical label
 *  when one was set, otherwise the raw label. Every recurrence / lineage /
 *  routing / graph path keys on this so a canonicalized alias converges on one
 *  node/wiki identity without losing the original raw source row. */
export function effectiveLabel(e: Pick<EntryEntity, 'label' | 'canonical_label'>): string {
  const canon = (e.canonical_label ?? '').trim()
  return canon.length > 0 ? canon : e.label
}

function rowToEntity(row: Record<string, unknown>): EntryEntity {
  return {
    id: String(row.id),
    entry_id: String(row.entry_id),
    type: String(row.type) as EntityType,
    label: String(row.label),
    created_at: Number(row.created_at),
    canonical_label: row.canonical_label == null ? null : String(row.canonical_label),
    updated_at: Number(row.updated_at ?? row.created_at),
  }
}

// Deterministic id so re-tagging an entry collapses to the same rows (and the
// same sync records) instead of duplicating.
function entityId(entryId: string, type: EntityType, label: string): string {
  return `${entryId}:${type}:${label.toLowerCase()}`
}

/**
 * Replace the set of entities attached to an entry (delete-then-insert in one
 * transaction) and enqueue each for E2E sync. F-02B — the delete-then-insert
 * now preserves any `canonical_label` previously stamped on a surviving row so
 * re-extraction (catch-up `/reflect`, re-tagging, …) emitting the same raw
 * entity again does not erase a canonicalization performed by belief
 * maintenance. `updated_at` is bumped so the preserved canonicalization reaches
 * other devices. **Maintenance itself never uses this replace-set helper** — it
 * writes `canonical_label` directly via `setCanonicalLabel` so it can't be
 * wiped by an entry re-extraction mid-pass. Best-effort enqueue — a queue
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
    rows.push({
      id: entityId(entryId, e.type, label),
      entry_id: entryId,
      type: e.type,
      label,
      created_at: now,
      canonical_label: null,
      updated_at: now,
    })
  }
  try {
    await db.transaction(async (tx) => {
      // Carry forward canonical identity, original creation time, and a strictly
      // newer watermark for surviving rows.
      const survived = new Set(rows.map((r) => r.id))
      const existing = await tx.execute(
        'SELECT id, canonical_label, created_at, updated_at FROM entry_entities WHERE entry_id = ?',
        [entryId]
      )
      const preserved = new Map<string, { canonical: string | null; created: number; updated: number }>()
      for (const r of existing.rows) {
        const id = String(r.id)
        if (survived.has(id)) {
          preserved.set(id, {
            canonical: r.canonical_label == null ? null : String(r.canonical_label),
            created: Number(r.created_at) || now,
            updated: Number(r.updated_at) || Number(r.created_at) || 0,
          })
        }
      }
      await tx.execute('DELETE FROM entry_entities WHERE entry_id = ?', [entryId])
      for (const r of rows) {
        const old = preserved.get(r.id)
        const canonical = old?.canonical ?? null
        const created = old?.created ?? r.created_at
        const updated = old ? Math.max(old.updated + 1, now) : r.updated_at
        await tx.execute(
          'INSERT INTO entry_entities (id, entry_id, type, label, canonical_label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.id, r.entry_id, r.type, r.label, canonical, created, updated]
        )
        await enqueueUpsertInTransaction('entry_entities', r.id, tx)
      }
      if (rows.some((r) => r.type === 'belief')) {
        const bump = await incrementSourceGeneration('belief', tx)
        if (!bump.success) throw new Error(bump.error.code)
      }
    })
    if (rows.length > 0) notifySyncPending()
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
/** All distinct RAW labels for belief-type entities — used by the semantic
 *  dedup step and by belief maintenance (F-02C) to look for near-duplicate
 *  beliefs across entries. Returns RAW labels, not effective: maintenance must
 *  cluster on raw observations so a prior bad alias decision stays observable
 *  and repairable. Best-effort; caller treats empty result as "no existing
 *  labels to compare against". */
export async function listDistinctBeliefLabels(
  db: SqliteDatabase = getDb()
): Promise<Result<string[]>> {
  try {
    const res = await db.execute(
      'SELECT DISTINCT label FROM entry_entities WHERE type = ? ORDER BY label COLLATE NOCASE',
      ['belief']
    )
    return ok(res.rows.map((r) => String(r.label)))
  } catch (e) {
    return err('BELIEF_LABEL_LIST_FAILED', 'Failed to list distinct belief labels', e)
  }
}

/** Count entries mentioning an entity by EFFECTIVE label: a row whose
 *  `canonical_label` matches counts the same as a row whose raw `label`
 *  matches, so a canonicalized alias contributes to one node/recurrence/wiki
 *  identity instead of fragmenting the count across two labels. The wiki
 *  recurrence gate queries by effective label. */
export async function countEntriesForEntity(
  type: EntityType,
  label: string,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    const res = await db.execute(
      `SELECT COUNT(DISTINCT entry_id) AS n FROM entry_entities
        WHERE type = ? AND COALESCE(canonical_label, label) = ? COLLATE NOCASE`,
      [type, label]
    )
    return ok(Number(res.rows[0]?.n ?? 0))
  } catch (e) {
    return err('ENTITY_COUNT_FAILED', 'Failed to count entity entries', e)
  }
}

/** F-02B — set the canonical label for a single entity row and bump its LWW
 *  watermark so the change reaches other devices. Used by belief maintenance
 *  (F-02C) to retire a raw alias without deleting the source row; never used by
 *  the re-tag replace-set helper (which preserves but does not write
 *  canonical_label). The source update and queue row commit together. */
export async function setCanonicalLabel(
  rowId: string,
  canonicalLabel: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  const canon = canonicalLabel.trim()
  if (!canon) return err('ENTITY_CANON_INVALID', 'canonical label must be non-empty')
  try {
    let changed = false
    await db.transaction(async (tx) => {
      const current = await tx.execute('SELECT canonical_label FROM entry_entities WHERE id = ?', [rowId])
      if (current.rows.length === 0) throw new Error('ENTITY_NOT_FOUND')
      if (current.rows[0].canonical_label != null && String(current.rows[0].canonical_label) === canon) return
      const updated = await tx.execute(
        `UPDATE entry_entities
          SET canonical_label = ?, updated_at = MAX(updated_at + 1, ?)
          WHERE id = ?`,
        [canon, Date.now(), rowId]
      )
      if (updated.rowsAffected !== 1) throw new Error('ENTITY_NOT_FOUND')
      await enqueueUpsertInTransaction('entry_entities', rowId, tx)
      changed = true
    })
    if (changed) notifySyncPending()
    return ok(undefined)
  } catch (e) {
    return err('ENTITY_CANON_FAILED', 'Failed to set canonical label', e)
  }
}
