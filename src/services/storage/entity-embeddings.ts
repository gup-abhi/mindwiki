import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'

/** Tiny deterministic hash so re-embedding skips unchanged labels. */
function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Semantic vectors for entity labels — one row per (label, type) pair.
 * Device-local and NOT synced (the vector depends on this device's embedding
 * model, identical to page_embeddings). Without a row the caller simply falls
 * back to exact label matching.
 */
export interface EntityEmbedding {
  label: string
  type: string
  vector: number[]
  contentHash: string
}

/** Upsert one entity's embedding vector. */
export async function upsertEntityEmbedding(
  label: string,
  type: string,
  vector: number[],
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute(
      `INSERT INTO entity_embeddings (label, type, dim, vector, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(label, type) DO UPDATE SET
         dim = excluded.dim,
         vector = excluded.vector,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at`,
      [label, type, vector.length, JSON.stringify(vector), hash(label), Date.now()]
    )
    return ok(undefined)
  } catch (e) {
    return err('ENTITY_EMBEDDING_WRITE_FAILED', 'Failed to store entity embedding', e)
  }
}

/** All stored entity embeddings for a given type, keyed by label. */
export async function listEntityEmbeddings(
  type: string,
  db: SqliteDatabase = getDb()
): Promise<Result<Map<string, EntityEmbedding>>> {
  try {
    const res = await db.execute(
      'SELECT label, type, vector FROM entity_embeddings WHERE type = ?',
      [type]
    )
    const map = new Map<string, EntityEmbedding>()
    for (const row of res.rows) {
      const label = String(row.label)
      map.set(label, {
        label,
        type: String(row.type),
        vector: JSON.parse(String(row.vector)) as number[],
        contentHash: '',
      })
    }
    return ok(map)
  } catch (e) {
    return err('ENTITY_EMBEDDING_LIST_FAILED', 'Failed to list entity embeddings', e)
  }
}

/** Remove entity embeddings for labels that no longer exist in entry_entities. */
export async function pruneStaleEntityEmbeddings(
  type: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute(
      `DELETE FROM entity_embeddings
       WHERE type = ?
         AND label NOT IN (SELECT DISTINCT label FROM entry_entities WHERE type = ?)`,
      [type, type]
    )
    return ok(undefined)
  } catch (e) {
    return err('ENTITY_EMBEDDING_PRUNE_FAILED', 'Failed to prune entity embeddings', e)
  }
}

/**
 * Backfill entity-embeddings for every known label of a type (best-effort).
 * Skips labels whose stored hash already matches current content. Returns how
 * many were (re)embedded.
 */
export async function backfillEntityEmbeddings(
  type: string,
  embedFn: (text: string) => Promise<Result<number[]>>,
  db: SqliteDatabase = getDb()
): Promise<number> {
  let embedded = 0
  try {
    const labelsRes = await db.execute(
      'SELECT DISTINCT label FROM entry_entities WHERE type = ? ORDER BY label COLLATE NOCASE',
      [type]
    )
    const storedRes = await db.execute(
      'SELECT label, content_hash FROM entity_embeddings WHERE type = ?',
      [type]
    )
    const storedHashes = new Map<string, string>()
    for (const row of storedRes.rows) storedHashes.set(String(row.label), String(row.content_hash))

    for (const row of labelsRes.rows) {
      const label = String(row.label)
      if (storedHashes.get(label) === hash(label)) continue
      const vec = await embedFn(label)
      if (!vec.success) break // model unavailable — stop this pass
      await upsertEntityEmbedding(label, type, vec.data, db)
      embedded++
    }
  } catch {
    // best-effort, never throw
  }
  return embedded
}
