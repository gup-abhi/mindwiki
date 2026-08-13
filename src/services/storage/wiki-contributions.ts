// F-01 Slice 7a — device-local wiki_page_contributions receipt store.
//
// Purpose: make interrupted/retried synthesis idempotent. When a tag-triggered
// wiki synthesis commits a page update, it ALSO inserts a row into
// `wiki_page_contributions(entry_id, page_id, created_at)` in the same
// transaction. On a retry (app restart, model-ready catch-up, mid-flight call)
// the presence of a receipt for (entry_id, page_id) means that the synthesis for
// that topic on that entry already committed, so catch-up can skip it without
// double-incrementing `wiki_pages.entry_count`.
//
// Never synced. Synced-in entries arrive wiki-indexed already; this table only
// makes local interrupted passes safe.
//
// Maintenance re-ground differs: it reconciles coverage across ALL matching
// source entries for a page, and the same transaction inserts a receipt for
// every matching source not already recorded, so an entry absorbed by re-ground
// cannot later increment again.

import { type Result, ok, err } from '@/types/result'
import type { SqliteDatabase } from './db'
import { getDb } from './db'

/**
 * Insert a contribution receipt. Returns `{ inserted: boolean }` — `false` when
 * a receipt for (entryId, pageId) already existed (idempotent skip), `true` when
 * a new receipt was persisted. Uses INSERT OR IGNORE so a duplicate key is not
 * surfaced as an exception (the maintenance path reads affected rows).
 */
export async function insertContribution(
  entryId: string,
  pageId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<{ inserted: boolean }>> {
  try {
    const res = await db.execute(
      `INSERT OR IGNORE INTO wiki_page_contributions (entry_id, page_id, created_at)
       VALUES (?, ?, ?)`,
      [entryId, pageId, Date.now()]
    )
    return ok({ inserted: Number(res.rowsAffected ?? 0) > 0 })
  } catch (e) {
    return err('WIKI_CONTRIBUTION_INSERT_FAILED', 'Failed to record wiki contribution', e)
  }
}

/**
 * True if a contribution receipt exists for (entryId, pageId). Used by catch-up
 * to skip topics already synthesised for this entry.
 */
export async function hasContribution(
  entryId: string,
  pageId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<boolean>> {
  try {
    const res = await db.execute(
      'SELECT entry_id FROM wiki_page_contributions WHERE entry_id = ? AND page_id = ?',
      [entryId, pageId]
    )
    return ok(res.rows.length > 0)
  } catch (e) {
    return err('WIKI_CONTRIBUTION_QUERY_FAILED', 'Failed to check wiki contribution', e)
  }
}

/** List the page ids this entry has actually contributed to. */
export interface ContributionSummary {
  count: number
  lastCreatedAt: number | null
}

export async function getContributionSummary(
  pageId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<ContributionSummary>> {
  try {
    const res = await db.execute(
      'SELECT COUNT(*) AS count, MAX(created_at) AS last_created_at FROM wiki_page_contributions WHERE page_id = ?',
      [pageId]
    )
    const row = res.rows[0]
    return ok({
      count: Number(row?.count ?? 0),
      lastCreatedAt: row?.last_created_at == null ? null : Number(row.last_created_at),
    })
  } catch (e) {
    return err('WIKI_CONTRIBUTION_SUMMARY_FAILED', 'Failed to summarize wiki contributions', e)
  }
}

/** List the page ids this entry has actually contributed to. */
export async function listContributions(
  entryId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<string[]>> {
  try {
    const res = await db.execute(
      'SELECT page_id FROM wiki_page_contributions WHERE entry_id = ? ORDER BY created_at ASC',
      [entryId]
    )
    return ok(res.rows.map((row) => String(row.page_id)))
  } catch (e) {
    return err('WIKI_CONTRIBUTION_LIST_FAILED', 'Failed to list wiki contributions', e)
  }
}

/**
 * Bulk-insert missing receipts for a set of (entry_id, page_id) pairs — used by
 * re-ground maintenance to record every local matching source now represented by
 * the rewrite. Existing receipts are skipped via INSERT OR IGNORE. Returns the
 * count of newly-inserted rows. Caller drives the transaction so the receipts
 * commit alongside the page rewrite / count reconciliation.
 */
export async function insertMissingReceipts(
  entryIds: string[],
  pageId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<{ inserted: number }>> {
  if (entryIds.length === 0) return ok({ inserted: 0 })
  try {
    // First, find which ones are already recorded so we only insert the missing.
    // Single SELECT + an INSERT OR IGNORE based on the result, instead of a
    // (potentially many) VALUES batch — keeps the query shape stable and
    // SQLite-friendly across roots.
    const placeholders = entryIds.map(() => '?').join(', ')
    const already = new Set<string>()
    const sel = await db.execute(
      `SELECT entry_id FROM wiki_page_contributions WHERE entry_id IN (${placeholders}) AND page_id = ?`,
      [...entryIds, pageId]
    )
    for (const r of sel.rows) already.add(String((r as { entry_id: unknown }).entry_id))

    let inserted = 0
    for (const id of entryIds) {
      if (already.has(id)) continue
      const r = await db.execute(
        `INSERT OR IGNORE INTO wiki_page_contributions (entry_id, page_id, created_at)
         VALUES (?, ?, ?)`,
        [id, pageId, Date.now()]
      )
      if (Number(r.rowsAffected ?? 0) > 0) inserted++
    }
    return ok({ inserted })
  } catch (e) {
    return err('WIKI_CONTRIBUTION_BULK_INSERT_FAILED', 'Failed to bulk-record contributions', e)
  }
}
