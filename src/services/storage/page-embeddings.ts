import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'

/**
 * Semantic vectors for wiki pages — one row per page. Derived, device-local, and
 * NOT synced (the vector depends on this device's embedding model). A page
 * without a row simply falls back to lexical ranking. The vector is stored as a
 * JSON float array (TEXT); `content_hash` lets backfill skip pages whose content
 * hasn't changed since they were last embedded.
 */
export interface PageEmbedding {
  pageId: string
  vector: number[]
  contentHash: string
}

/** Upsert one page's vector (replacing any prior one). */
export async function upsertPageEmbedding(
  pageId: string,
  vector: number[],
  contentHash: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute(
      `INSERT INTO page_embeddings (page_id, dim, vector, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET
         dim = excluded.dim,
         vector = excluded.vector,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at`,
      [pageId, vector.length, JSON.stringify(vector), contentHash, Date.now()]
    )
    return ok(undefined)
  } catch (e) {
    return err('PAGE_EMBEDDING_WRITE_FAILED', 'Failed to store page embedding', e)
  }
}

/** All stored page embeddings, keyed by page id. */
export async function listPageEmbeddings(
  db: SqliteDatabase = getDb()
): Promise<Result<Map<string, PageEmbedding>>> {
  try {
    const res = await db.execute('SELECT page_id, vector, content_hash FROM page_embeddings')
    const map = new Map<string, PageEmbedding>()
    for (const row of res.rows) {
      const pageId = String(row.page_id)
      map.set(pageId, {
        pageId,
        vector: JSON.parse(String(row.vector)) as number[],
        contentHash: String(row.content_hash),
      })
    }
    return ok(map)
  } catch (e) {
    return err('PAGE_EMBEDDING_LIST_FAILED', 'Failed to list page embeddings', e)
  }
}
