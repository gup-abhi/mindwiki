import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsert, enqueueUpsertInTransaction, notifySyncPending } from './sync-queue'
import { insertContribution, insertMissingReceipts } from './wiki-contributions'

export interface WikiPageVersion {
  version: number
  content: string
  updated_at: number
}

// Version-history cap: keep the first version, monthly snapshots from the middle,
// and the KEEP_LAST_N most recent versions. Sync re-uploads the whole row, so an
// unbounded history turns into an O(n²) liability in both storage and bandwidth.
const MAX_VERSION_HISTORY = 20
const KEEP_LAST_N = 10

export function capVersionHistory(history: WikiPageVersion[]): WikiPageVersion[] {
  // Dedupe by version (last write wins) and sort ascending so the retention
  // math is order-independent of how the caller assembled the history.
  const byVersion = new Map<number, WikiPageVersion>()
  for (const v of history) byVersion.set(v.version, v)
  const ordered = [...byVersion.values()].sort((a, b) => a.version - b.version)
  if (ordered.length <= MAX_VERSION_HISTORY) return ordered

  // Always preserve the first version (v1 — the original synthesis) and the
  // KEEP_LAST_N most recent versions (fine-grained recent evolution).
  const first = [ordered[0]]
  const recent = ordered.slice(-KEEP_LAST_N)

  // Remaining middle candidates, ordered oldest → recent.
  const mid = ordered.slice(1, ordered.length - KEEP_LAST_N)

  // Collapse the middle to one deterministic candidate per UTC calendar month
  // (the first candidate in that month, in version order — already the case
  // since `mid` is version-asc). Invalid timestamps fall back to a single
  // shared bucket so they never throw and still order by version.
  const monthly: WikiPageVersion[] = []
  const seenMonth = new Set<string>()
  const monthKey = (ts: number): string => {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return 'invalid'
    try {
      return d.toISOString().slice(0, 7) // YYYY-MM
    } catch {
      return 'invalid'
    }
  }
  for (const v of mid) {
    const m = monthKey(v.updated_at)
    if (seenMonth.has(m)) continue
    seenMonth.add(m)
    monthly.push(v)
  }

  // Hard budget: 20 total − first − recent. When recent is exactly the cap
  // (KEEP_LAST_N=10), the middle gets exactly nine temporal anchors so the
  // whole retained chain can never exceed 20 even before the final safety trim.
  const slots = Math.max(0, MAX_VERSION_HISTORY - 1 - recent.length)
  let sampled: WikiPageVersion[]
  if (monthly.length <= slots) {
    sampled = monthly
  } else {
    // Evenly spaced temporal anchors across the monthly candidates, including
    // the oldest and newest middle entries so evolution gaps span the full
    // middle window. Picks exactly `slots` candidates when slots ≥ 2.
    const n = monthly.length
    const picked: WikiPageVersion[] = [monthly[0]]
    for (let s = 1; s < slots - 1 && slots > 1; s++) {
      // Map s ∈ [0..slots) to a monthly index that always lands on the last
      // candidate at s = slots-1; avoids float-rounding off-by-one.
      const idx = Math.round((s * (n - 1)) / (slots - 1))
      if (idx > 0 && idx < n) picked.push(monthly[idx])
    }
    picked.push(monthly[n - 1])
    sampled = picked
  }

  // Merge, dedupe by version, sort ascending. The first+recent anchors are
  // disjoint by construction, and the middle sample was drawn from rows
  // outside the recent slice, so no version overlaps. The final slice is a
  // defensive hard cap — the budget math already guarantees ≤ 20.
  const merged = new Map<number, WikiPageVersion>()
  for (const v of [...first, ...sampled, ...recent]) merged.set(v.version, v)
  return [...merged.values()].sort((a, b) => a.version - b.version).slice(0, MAX_VERSION_HISTORY)
}

export interface WikiPage {
  id: string
  title: string
  category: string | null
  content: string
  entry_count: number
  version: number
  version_history: WikiPageVersion[]
  created_at: number
  updated_at: number
  /** When the user dropped this page as inaccurate; null when active. */
  dismissed_at: number | null
  /** When the user last rewrote this page in their own words; null once the AI
   * has re-synthesized over it. */
  corrected_at: number | null
  /** When this page was merged into another (topic de-dup): holds the survivor's
   * id. Hidden from both the active wiki and "Dropped insights" — it was
   * consolidated, not dropped by the user. Null for normal pages. */
  merged_into: string | null
  /** Entry_count at which the last aggregate synthesis was applied. Pages with
   * aggregated_upto == null are treated as 0 (first aggregate due). Emotion
   * pages only; all others ignore this field. */
  aggregated_upto: number
  /** Highest distinct matching source count whose re-ground result successfully
   * committed. Defaults to 0 for pre-migration pages. Non-emotion pages only;
   * emotion pages rely on aggregated_upto. */
  regrounded_upto: number
}

export interface NewWikiPage {
  title: string
  category?: string | null
  content?: string
  entry_count?: number
}

function rowToPage(row: Record<string, unknown>): WikiPage {
  let history: WikiPageVersion[] = []
  try {
    const parsed = JSON.parse(String(row.version_history ?? '[]'))
    if (Array.isArray(parsed)) history = parsed
  } catch {
    history = []
  }
  return {
    id: String(row.id),
    title: String(row.title),
    category: row.category == null ? null : String(row.category),
    content: String(row.content ?? ''),
    entry_count: Number(row.entry_count ?? 0),
    version: Number(row.version ?? 1),
    version_history: history,
    aggregated_upto: row.aggregated_upto == null ? 0 : Number(row.aggregated_upto),
    regrounded_upto: row.regrounded_upto == null ? 0 : Number(row.regrounded_upto),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    dismissed_at: row.dismissed_at == null ? null : Number(row.dismissed_at),
    corrected_at: row.corrected_at == null ? null : Number(row.corrected_at),
    merged_into: row.merged_into == null ? null : String(row.merged_into),
  }
}

export async function createPage(
  input: NewWikiPage,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage>> {
  const now = Date.now()
  const entryCount = input.entry_count ?? 0
  const page: WikiPage = {
    id: randomUUID(),
    title: input.title,
    category: input.category ?? null,
    content: input.content ?? '',
    entry_count: entryCount,
    version: 1,
    version_history: [],
    aggregated_upto: 0,
    regrounded_upto: 0,
    created_at: now,
    updated_at: now,
    dismissed_at: null,
    corrected_at: null,
    merged_into: null,
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO wiki_pages
           (id, title, category, content, entry_count, version, version_history, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [page.id, page.title, page.category, page.content, entryCount, 1, '[]', now, now]
      )
      await enqueueUpsertInTransaction('wiki_pages', page.id, tx)
    })
    notifySyncPending()
    return ok(page)
  } catch (e) {
    // A concurrent indexer may have created the same live title after the
    // caller's lookup. Re-read the DB winner; the unique index is authoritative.
    const message = e instanceof Error ? e.message : String(e)
    if (/unique|constraint/i.test(message)) {
      const existing = await getPageByTitle(page.title, db)
      if (existing.success && existing.data) return ok(existing.data)
    }
    return err('WIKI_CREATE_FAILED', 'Failed to create wiki page', e)
  }
}

/** Create contentful v1 plus durable entry receipt and sync row atomically. */
export async function createPageWithContribution(
  input: NewWikiPage,
  entryId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<{ page: WikiPage; created: boolean }>> {
  const now = Date.now()
  const page: WikiPage = {
    id: randomUUID(),
    title: input.title,
    category: input.category ?? null,
    content: input.content ?? '',
    entry_count: input.entry_count ?? 0,
    version: 1,
    version_history: [],
    aggregated_upto: 0,
    regrounded_upto: 0,
    created_at: now,
    updated_at: now,
    dismissed_at: null,
    corrected_at: null,
    merged_into: null,
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO wiki_pages
           (id, title, category, content, entry_count, version, version_history, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [page.id, page.title, page.category, page.content, page.entry_count, 1, '[]', now, now]
      )
      const receipt = await insertContribution(entryId, page.id, tx)
      if (!receipt.success || !receipt.data.inserted) {
        throw new Error(receipt.success ? 'WIKI_CONTRIBUTION_DUPLICATE' : receipt.error.code)
      }
      const queued = await enqueueUpsert('wiki_pages', page.id, tx, false)
      if (!queued.success) throw new Error(queued.error.code)
    })
    notifySyncPending()
    return ok({ page, created: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/unique|constraint/i.test(message)) {
      const existing = await getPageByTitle(page.title, db)
      if (existing.success && existing.data) return ok({ page: existing.data, created: false })
    }
    return err('WIKI_CREATE_FAILED', 'Failed to create wiki page', e)
  }
}

export async function getPage(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage | null>> {
  try {
    const res = await db.execute('SELECT * FROM wiki_pages WHERE id = ?', [id])
    const row = res.rows[0]
    return ok(row ? rowToPage(row) : null)
  } catch (e) {
    return err('WIKI_GET_FAILED', 'Failed to read wiki page', e)
  }
}

export async function getPageByTitle(
  title: string,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage | null>> {
  try {
    const res = await db.execute(
      `SELECT * FROM wiki_pages
         WHERE title = ? COLLATE NOCASE
         ORDER BY (merged_into IS NULL) DESC, (dismissed_at IS NULL) DESC, updated_at DESC
         LIMIT 1`,
      [title]
    )
    const row = res.rows[0]
    return ok(row ? rowToPage(row) : null)
  } catch (e) {
    return err('WIKI_GET_FAILED', 'Failed to read wiki page', e)
  }
}

/**
 * Increment an emotion page's entry_count without changing its content.
 * Emotion pages skip per-entry synthesis in favour of periodic aggregate
 * synthesis, so we still need the counter for RICHNESS_BOOST in search.
 * Returns the updated page or an error if the page doesn't exist.
 */
export async function ticklePageCount(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage>> {
  try {
    let current: WikiPage | null = null
    await db.transaction(async (tx) => {
      const now = Date.now()
      // SQLite performs the increment under its write lock. A read-modify-write
      // pair loses one count when background indexers overlap.
      const changed = await tx.execute(
        'UPDATE wiki_pages SET entry_count = entry_count + 1, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
        [now, id]
      )
      if ((changed.rowsAffected ?? 0) === 0) throw new Error('WIKI_NOT_FOUND')
      const got = await getPage(id, tx)
      if (!got.success) throw new Error(got.error.code)
      if (got.data == null) throw new Error('WIKI_NOT_FOUND')
      current = got.data
      await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    notifySyncPending()
    if (!current) return err('WIKI_NOT_FOUND', 'Wiki page not found')
    return ok(current)
  } catch (e) {
    if (e instanceof Error && e.message === 'WIKI_NOT_FOUND') return err('WIKI_NOT_FOUND', 'Wiki page not found')
    return err('WIKI_TICKLE_FAILED', 'Failed to tickle wiki page entry count', e)
  }
}

/** Persist an aggregate rewrite and its completion marker as one syncable row.
 * The marker is never durable without the final content and queue record. */
export async function regeneratePageContentWithAggregate(
  id: string,
  content: string,
  upto: number,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage>> {
  try {
    let next: WikiPage | null = null
    await db.transaction(async (tx) => {
      const current = await getPage(id, tx)
      if (!current.success) throw new Error(current.error.code)
      if (!current.data) throw new Error('WIKI_NOT_FOUND')
      const prev = current.data
      const history = capVersionHistory([
        ...prev.version_history,
        { version: prev.version, content: prev.content, updated_at: prev.updated_at },
      ])
      const now = Date.now()
      const updatedAt = Math.max(prev.updated_at + 1, now)
      next = {
        ...prev,
        content,
        version: prev.version + 1,
        version_history: history,
        updated_at: updatedAt,
        corrected_at: null,
        aggregated_upto: upto,
      }
      await tx.execute(
        `UPDATE wiki_pages
           SET content = ?, version = ?, version_history = ?, updated_at = ?,
               corrected_at = NULL, aggregated_upto = ?
         WHERE id = ?`,
        [content, next.version, JSON.stringify(history), updatedAt, upto, id]
      )
      const queued = await enqueueUpsert('wiki_pages', id, tx, false)
      if (!queued.success) throw new Error(queued.error.code)
    })
    // Queue SQL committed with the page; only the wake-up is post-commit.
    if (!next) return err('WIKI_NOT_FOUND', 'Wiki page not found')
    notifySyncPending()
    return ok(next)
  } catch (e) {
    return err('WIKI_AGGREGATE_UPDATE_FAILED', 'Failed to persist emotion aggregate', e)
  }
}

/** @deprecated Use regeneratePageContentWithAggregate for aggregate writes. */
export async function setAggregatedUpto(
  id: string,
  upto: number,
  db: SqliteDatabase = getDb()
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        'UPDATE wiki_pages SET aggregated_upto = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
        [upto, Date.now(), id]
      )
      const queued = await enqueueUpsert('wiki_pages', id, tx, false)
      if (!queued.success) throw new Error(queued.error.code)
    })
    notifySyncPending()
  } catch {
    // Compatibility API preserves its historical void/best-effort contract.
  }
}

/**
 * Remove blank, never-synthesized pages (no content, 0 entries). These are
 * legacy shells from a failed background synthesis; new ones are no longer
 * created (the engine synthesizes before creating). Returns the count removed.
 */
export async function deleteEmptyPages(db: SqliteDatabase = getDb()): Promise<Result<number>> {
  try {
    const res = await db.execute(
      "DELETE FROM wiki_pages WHERE entry_count = 0 AND content = ''"
    )
    return ok(res.rowsAffected ?? 0)
  } catch (e) {
    return err('WIKI_PURGE_FAILED', 'Failed to remove empty wiki pages', e)
  }
}

/**
 * Active wiki pages (dismissed ones excluded). This is the single source for
 * retrieval grounding (Reflect, suggested questions) and the wiki list, so a
 * dropped page stops shaping any future interaction.
 */
export async function listPages(db: SqliteDatabase = getDb()): Promise<Result<WikiPage[]>> {
  try {
    const res = await db.execute(
      'SELECT * FROM wiki_pages WHERE dismissed_at IS NULL AND merged_into IS NULL ORDER BY updated_at DESC'
    )
    return ok(res.rows.map(rowToPage))
  } catch (e) {
    return err('WIKI_LIST_FAILED', 'Failed to list wiki pages', e)
  }
}

/** Pages the user has dropped as inaccurate, most-recently-dropped first. */
export async function listDismissedPages(
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage[]>> {
  try {
    const res = await db.execute(
      'SELECT * FROM wiki_pages WHERE dismissed_at IS NOT NULL AND merged_into IS NULL ORDER BY dismissed_at DESC'
    )
    return ok(res.rows.map(rowToPage))
  } catch (e) {
    return err('WIKI_LIST_FAILED', 'Failed to list dismissed wiki pages', e)
  }
}

/** Drop a page the user flagged as inaccurate (soft + reversible). */
export async function dismissPage(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.transaction(async (tx) => {
      const now = Date.now()
      const res = await tx.execute(
        'UPDATE wiki_pages SET dismissed_at = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
        [now, now, id]
      )
      if ((res.rowsAffected ?? 0) === 0) throw new Error('WIKI_NOT_FOUND')
      await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    notifySyncPending()
    return ok(undefined)
  } catch (e) {
    if (e instanceof Error && e.message === 'WIKI_NOT_FOUND') return err('WIKI_NOT_FOUND', 'Wiki page not found')
    return err('WIKI_DISMISS_FAILED', 'Failed to dismiss wiki page', e)
  }
}

/** Restore a previously dropped page. */
export async function restorePage(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.transaction(async (tx) => {
      const now = Date.now()
      const res = await tx.execute(
        'UPDATE wiki_pages SET dismissed_at = NULL, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
        [now, id]
      )
      if ((res.rowsAffected ?? 0) === 0) throw new Error('WIKI_NOT_FOUND')
      await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    notifySyncPending()
    return ok(undefined)
  } catch (e) {
    if (e instanceof Error && e.message === 'WIKI_NOT_FOUND') return err('WIKI_NOT_FOUND', 'Wiki page not found')
    return err('WIKI_RESTORE_FAILED', 'Failed to restore wiki page', e)
  }
}

/**
 * Replace a page's content with a new synthesized version: archive the current
 * content into version_history, bump the version, increment entry_count.
 */
export async function updatePage(
  id: string,
  content: string,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage>> {
  try {
    let next: WikiPage | null = null
    await db.transaction(async (tx) => {
      const current = await getPage(id, tx)
      if (!current.success) throw new Error(current.error.code)
      if (current.data == null) throw new Error('WIKI_NOT_FOUND')

      const prev = current.data
      const rawHistory: WikiPageVersion[] = [
        ...prev.version_history,
        { version: prev.version, content: prev.content, updated_at: prev.updated_at },
      ]
      const history = capVersionHistory(rawHistory)
      const now = Date.now()
      const updatedAt = Math.max(prev.updated_at + 1, now)
      next = {
        ...prev,
        content,
        version: prev.version + 1,
        version_history: history,
        entry_count: prev.entry_count + 1,
        updated_at: updatedAt,
        // A fresh synthesis heals a previously-dropped page: clear the flag so it
        // rejoins retrieval (the engine regenerates its content from scratch). It
        // also supersedes a user correction — the content now folds in a new entry,
        // so it's no longer purely the user's words.
        dismissed_at: null,
        corrected_at: null,
      }

      await tx.execute(
        `UPDATE wiki_pages
           SET content = ?, version = ?, version_history = ?, entry_count = ?, updated_at = ?,
               dismissed_at = NULL, corrected_at = NULL
         WHERE id = ?`,
        [next.content, next.version, JSON.stringify(history), next.entry_count, updatedAt, id]
      )
      await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    notifySyncPending()
    if (!next) return err('WIKI_NOT_FOUND', 'Wiki page not found')
    return ok(next)
  } catch (e) {
    if (e instanceof Error && e.message === 'WIKI_NOT_FOUND') return err('WIKI_NOT_FOUND', 'Wiki page not found')
    return err('WIKI_UPDATE_FAILED', 'Failed to update wiki page', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// F-01 Slice 7a — Compare-and-set page persistence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare-and-set: only applies when `baseVersion` matches the current page
 * version (no concurrent write raced ahead). Returns `{ page, affected }`:
 * - `affected === 1` and `page` populated on success.
 * - `affected === 0` and `page === null` when stale — caller should retry once
 *   (re-read page, re-synthesize, re-apply).
 *
 * Semantics match `updatePage` but the WHERE clause includes `AND version = ?`
 * so a stale synthesis result cannot silently overwrite a newer revision.
 */
export interface WikiPageCASFields {
  entry_count?: number
  regrounded_upto?: number
}

export interface WikiPageCASResult {
  page: WikiPage | null
  affected: number
  /** True when requested contribution receipt already existed. */
  skipped?: boolean
}

/** Internal sentinel: transaction must roll back receipt writes on stale CAS. */
function isWikiCASStale(error: unknown): boolean {
  return error instanceof Error && error.message === 'WIKI_CAS_STALE'
}

async function updatePageCASInternal(
  id: string,
  content: string,
  baseVersion: number,
  fields: WikiPageCASFields,
  contributionEntryId: string | undefined,
  contributionEntryIds: string[] | undefined,
  db: SqliteDatabase
): Promise<Result<WikiPageCASResult>> {
  let stale = false
  let skipped = false
  let next: WikiPage | null = null
  try {
    await db.transaction(async (tx) => {
      if (contributionEntryId) {
        const receipt = await insertContribution(contributionEntryId, id, tx)
        if (!receipt.success) throw new Error(receipt.error.code)
        if (!receipt.data.inserted) {
          skipped = true
          return
        }
      }
      if (contributionEntryIds && contributionEntryIds.length > 0) {
        const receipts = await insertMissingReceipts(contributionEntryIds, id, tx)
        if (!receipts.success) throw new Error(receipts.error.code)
      }

      const current = await getPage(id, tx)
      if (!current.success) throw new Error(current.error.code)
      if (current.data == null) throw new Error('WIKI_NOT_FOUND')

      const prev = current.data
      const rawHistory: WikiPageVersion[] = [
        ...prev.version_history,
        { version: prev.version, content: prev.content, updated_at: prev.updated_at },
      ]
      const history = capVersionHistory(rawHistory)
      const now = Date.now()
      const updatedAt = Math.max(prev.updated_at + 1, now)
      const nextEntryCount = fields.entry_count ?? prev.entry_count + 1
      next = {
        ...prev,
        content,
        version: prev.version + 1,
        version_history: history,
        entry_count: nextEntryCount,
        regrounded_upto: fields.regrounded_upto ?? prev.regrounded_upto,
        updated_at: updatedAt,
        dismissed_at: null,
        corrected_at: null,
      }

      const res = await tx.execute(
        `UPDATE wiki_pages
           SET content = ?, version = ?, version_history = ?, entry_count = ?,
               regrounded_upto = ?, updated_at = ?, dismissed_at = NULL, corrected_at = NULL
         WHERE id = ? AND version = ?`,
        [
          next.content,
          next.version,
          JSON.stringify(history),
          next.entry_count,
          next.regrounded_upto,
          updatedAt,
          id,
          baseVersion,
        ]
      )
      if (Number(res.rowsAffected ?? 0) === 0) {
        stale = true
        throw new Error('WIKI_CAS_STALE')
      }
      const queued = await enqueueUpsert('wiki_pages', id, tx, false)
      if (!queued.success) throw new Error(queued.error.code)
    })
    if (skipped) return ok({ page: null, affected: 0, skipped: true })
    if (!next) return err('WIKI_NOT_FOUND', 'Wiki page not found')
    notifySyncPending()
    return ok({ page: next, affected: 1 })
  } catch (e) {
    if (stale || isWikiCASStale(e)) return ok({ page: null, affected: 0 })
    return err('WIKI_UPDATE_FAILED', 'Failed to CAS-update wiki page', e)
  }
}

export async function updatePageCAS(
  id: string,
  content: string,
  baseVersion: number,
  fields: WikiPageCASFields,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPageCASResult>> {
  let stale = false
  let next: WikiPage | null = null
  try {
    await db.transaction(async (tx) => {
      const current = await getPage(id, tx)
      if (!current.success) throw new Error(current.error.code)
      if (current.data == null) throw new Error('WIKI_NOT_FOUND')
      const prev = current.data
      const history = capVersionHistory([
        ...prev.version_history,
        { version: prev.version, content: prev.content, updated_at: prev.updated_at },
      ])
      const now = Date.now()
      const updatedAt = Math.max(prev.updated_at + 1, now)
      const nextEntryCount = fields.entry_count ?? prev.entry_count + 1
      next = {
        ...prev,
        content,
        version: prev.version + 1,
        version_history: history,
        entry_count: nextEntryCount,
        regrounded_upto: fields.regrounded_upto ?? prev.regrounded_upto,
        updated_at: updatedAt,
        dismissed_at: null,
        corrected_at: null,
      }
      const res = await tx.execute(
        `UPDATE wiki_pages
           SET content = ?, version = ?, version_history = ?, entry_count = ?, updated_at = ?,
               dismissed_at = NULL, corrected_at = NULL
         WHERE id = ? AND version = ?`,
        [next.content, next.version, JSON.stringify(history), next.entry_count, updatedAt, id, baseVersion]
      )
      if (Number(res.rowsAffected ?? 0) === 0) {
        stale = true
        throw new Error('WIKI_CAS_STALE')
      }
      await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    if (stale || !next) return ok({ page: null, affected: 0 })
    notifySyncPending()
    return ok({ page: next, affected: 1 })
  } catch (e) {
    if (stale || isWikiCASStale(e)) return ok({ page: null, affected: 0 })
    if (e instanceof Error && e.message === 'WIKI_NOT_FOUND') return err('WIKI_NOT_FOUND', 'Wiki page not found')
    return err('WIKI_UPDATE_FAILED', 'Failed to CAS-update wiki page', e)
  }
}

/** CAS page write with durable contribution receipts in one transaction. */
export async function updatePageCASWithContribution(
  id: string,
  content: string,
  baseVersion: number,
  fields: WikiPageCASFields,
  entryId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPageCASResult>> {
  return updatePageCASInternal(id, content, baseVersion, fields, entryId, undefined, db)
}

/** CAS re-ground write with all source receipts in one transaction. */
export async function updatePageCASWithContributions(
  id: string,
  content: string,
  baseVersion: number,
  fields: WikiPageCASFields,
  entryIds: string[],
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPageCASResult>> {
  return updatePageCASInternal(id, content, baseVersion, fields, undefined, entryIds, db)
}

/**
 * Corrected-belief acknowledgment: increment `regrounded_upto` (and version)
 * without changing content, entry_count, or version_history. Used by the
 * re-ground maintenance path to record that the consistency sweep has accounted
 * for this page's coverage without a full re-synthesis.
 *
 * Uses CAS (WHERE id = ? AND version = ?) so stale writes are detected.
 * Returns `affected`: 1 on success, 0 when stale.
 */
export async function updatePageRegroundedUpto(
  id: string,
  newCount: number,
  baseVersion: number,
  db: SqliteDatabase = getDb()
): Promise<Result<{ affected: number }>> {
  try {
    let affected = 0
    await db.transaction(async (tx) => {
      const res = await tx.execute(
        `UPDATE wiki_pages SET regrounded_upto = ?, updated_at = MAX(updated_at + 1, ?), version = version + 1
         WHERE id = ? AND version = ?`,
        [newCount, Date.now(), id, baseVersion]
      )
      affected = Number(res.rowsAffected ?? 0) > 0 ? 1 : 0
      if (affected) await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    if (affected) notifySyncPending()
    return ok({ affected })
  } catch (e) {
    return err('WIKI_UPDATE_FAILED', 'Failed to update regrounded_upto', e)
  }
}

/**
 * Replace a page's content with the user's own words (correct-with-replacement):
 * archive the current content into version_history, bump the version, mark
 * corrected_at, and un-drop the page. Future synthesis builds on this text (the
 * engine uses the current content as its base), so the correction compounds
 * forward instead of being re-derived away. entry_count is left unchanged — a
 * correction is the user's edit, not a journal entry.
 */
export async function correctPage(
  id: string,
  content: string,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage>> {
  try {
    const current = await getPage(id, db)
    if (!current.success) return current
    if (current.data == null) {
      return err('WIKI_NOT_FOUND', 'Wiki page not found')
    }

    const prev = current.data
    const rawHistory: WikiPageVersion[] = [
      ...prev.version_history,
      { version: prev.version, content: prev.content, updated_at: prev.updated_at },
    ]
    const history = capVersionHistory(rawHistory)
    const now = Date.now()
    const updatedAt = Math.max(prev.updated_at + 1, now)
    const next: WikiPage = {
      ...prev,
      content,
      version: prev.version + 1,
      version_history: history,
      updated_at: updatedAt,
      corrected_at: updatedAt,
      dismissed_at: null,
    }

    await db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE wiki_pages
           SET content = ?, version = ?, version_history = ?, updated_at = ?,
               corrected_at = ?, dismissed_at = NULL
         WHERE id = ?`,
        [next.content, next.version, JSON.stringify(history), updatedAt, updatedAt, id]
      )
      await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    notifySyncPending()
    return ok(next)
  } catch (e) {
    return err('WIKI_CORRECT_FAILED', 'Failed to correct wiki page', e)
  }
}

/**
 * Replace a page's content with an AI regeneration (e.g. a voice rewrite):
 * archive the current content into version_history and bump the version, but
 * leave entry_count unchanged (no new entry was folded in) and clear corrected_at
 * (the content is AI-authored again, not the user's words).
 */
export async function regeneratePageContent(
  id: string,
  content: string,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage>> {
  try {
    const current = await getPage(id, db)
    if (!current.success) return current
    if (current.data == null) {
      return err('WIKI_NOT_FOUND', 'Wiki page not found')
    }

    const prev = current.data
    const rawHistory: WikiPageVersion[] = [
      ...prev.version_history,
      { version: prev.version, content: prev.content, updated_at: prev.updated_at },
    ]
    const history = capVersionHistory(rawHistory)
    const now = Date.now()
    const updatedAt = Math.max(prev.updated_at + 1, now)
    const next: WikiPage = {
      ...prev,
      content,
      version: prev.version + 1,
      version_history: history,
      updated_at: updatedAt,
      corrected_at: null,
    }

    await db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE wiki_pages
           SET content = ?, version = ?, version_history = ?, updated_at = ?, corrected_at = NULL
         WHERE id = ?`,
        [next.content, next.version, JSON.stringify(history), updatedAt, id]
      )
      await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })
    notifySyncPending()
    return ok(next)
  } catch (e) {
    return err('WIKI_REGEN_FAILED', 'Failed to regenerate wiki page', e)
  }
}
