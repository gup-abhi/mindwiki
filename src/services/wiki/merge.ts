import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { rebuildGraph } from '@/services/graph/engine'
import { type WikiPage } from '@/services/storage/wiki'
import { setSetting } from '@/services/storage/settings'
import { enqueueUpsertInTransaction, notifySyncPending } from '@/services/storage/sync-queue'
import { type Result, ok, err } from '@/types/result'

import { cosine } from './search'

/**
 * Cosine floor for suggesting two theme pages be merged. Merges are far less
 * reversible than the retrieval bonus embeddings otherwise feed, and bge-small
 * scores loosely-related themes highish, so this sits well above the retrieval
 * baseline (0.3) — only near-duplicates ("Work stress" / "Job pressure") clear
 * it. A suggestion, never an auto-merge; tunable on device like MIN_RELEVANCE.
 */
export const MERGE_THRESHOLD = 0.82

/** Settings key for the graph-rebuild repair marker. Set inside the merge
 *  transaction and cleared after a successful post-commit rebuildGraph(). If
 *  the app is killed between the commit and the rebuild, the marker stays set
 *  and bootstrap's startup retry runs the rebuild. */
const GRAPH_REBUILD_REQUIRED_KEY = 'maintenance:graph_rebuild_required'

export interface MergePair {
  /** The page the merge keeps (richer, then more recently updated). */
  survivor: WikiPage
  /** The page folded into the survivor. */
  loser: WikiPage
  similarity: number
}

/** Order-independent key for a page pair — for persisting "keep separate". Uses
 *  the pair's titles so it's human-readable in stored settings. Existing devices
 *  store title-based keys; reading them back works identically. Prefer
 *  pairKeyById for new suppressions — stable across title changes. */
export function pairKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join('\u0000')
}

/**
 * Order-independent key for a page pair using their IDs. Stable across title
 * changes — if a page is renamed (e.g., "Work stress" → "Career pressure"),
 * an ID-based suppression survives while a title-based one is lost.
 */
export function pairKeyById(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join('\u0000')
}

/**
 * Suggest near-duplicate theme pages to merge, most-similar first. Pure — the
 * caller supplies pages, their vectors, and the pair-keys the user has already
 * dismissed. Only `theme` pages are considered (emotion/distortion are controlled
 * vocab, person/place are proper nouns — none should fuse by meaning); dismissed,
 * already-merged, and unembedded pages are skipped.
 */
export function suggestMerges(
  pages: WikiPage[],
  vectors: Map<string, number[]>,
  suppressed: Set<string> = new Set()
): MergePair[] {
  const themes = pages.filter(
    (p) =>
      p.category === 'theme' &&
      p.dismissed_at == null &&
      p.merged_into == null &&
      vectors.has(p.id)
  )

  const pairs: MergePair[] = []
  for (let i = 0; i < themes.length; i++) {
    for (let j = i + 1; j < themes.length; j++) {
      const a = themes[i]
      const b = themes[j]
      const sim = cosine(vectors.get(a.id)!, vectors.get(b.id)!)
      if (sim < MERGE_THRESHOLD) continue
      // Check suppression by BOTH title key (legacy) and ID key (stable). A
      // user who dismissed "Work stress" / "Job pressure" before a rename to
      // "Career pressure" still has it suppressed via the ID key.
      if (
        suppressed.has(pairKey(a.title, b.title)) ||
        suppressed.has(pairKeyById(a.id, b.id))
      ) continue
      // Richer page survives (more compounded content); tie → more recent.
      const aWins =
        a.entry_count > b.entry_count ||
        (a.entry_count === b.entry_count && a.updated_at >= b.updated_at)
      pairs.push({ survivor: aWins ? a : b, loser: aWins ? b : a, similarity: sim })
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity)
}

/**
 * Load a page (fully fresh from the DB inside the current transaction) by id.
 * Returns null when not found. Used to validate current state before merging.
 */
async function loadPage(
  id: string,
  tx: SqliteDatabase
): Promise<{ id: string; title: string; category: string | null; dismissed_at: number | null; merged_into: string | null } | null> {
  const res = await tx.execute(
    'SELECT id, title, category, dismissed_at, merged_into FROM wiki_pages WHERE id = ?',
    [id]
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    title: String(row.title),
    category: row.category ? String(row.category) : null,
    dismissed_at: row.dismissed_at == null ? null : Number(row.dismissed_at),
    merged_into: row.merged_into == null ? null : String(row.merged_into),
  }
}

/**
 * Consolidate two theme pages the user confirmed are the same theme. Unlike the
 * string dedupe, the pair shares no canonical title, so this must re-point the
 * loser's entries explicitly — otherwise the graph keeps a loser node and future
 * synthesis stays fragmented.
 *
 * All source/page/sync-queue writes happen inside one SQLite transaction. The
 * derived graph is rebuilt after the transaction commits; if the rebuild fails,
 * a durable repair marker ensures the next launch retries it.
 *
 * The return includes `graphRebuilt: false` when the merge committed but the
 * post-commit graph rebuild failed — the marker guarantees repair on next
 * launch.
 */
export async function mergePages(
  survivor: WikiPage,
  loser: WikiPage,
  db: SqliteDatabase = getDb()
): Promise<Result<{ entriesRepointed: number; graphRebuilt: boolean }>> {
  try {
    if (survivor.id === loser.id) {
      return err('PAGE_MERGE_SELF', 'Cannot merge a page into itself')
    }

    let entriesRepointed = 0

    await db.transaction(async (tx) => {
      // 1. Validate current DB state inside the transaction, not the caller's
      //    possibly-stale WikiPage objects. This prevents double-counting when
      //    two overlapping merge requests race.
      const curSurvivor = await loadPage(survivor.id, tx)
      const curLoser = await loadPage(loser.id, tx)

      if (!curSurvivor || !curLoser) {
        throw new Error('PAGE_NOT_FOUND')
      }
      if (curSurvivor.dismissed_at != null) {
        throw new Error('SURVIVOR_DISMISSED')
      }
      if (curLoser.dismissed_at != null) {
        throw new Error('LOSER_DISMISSED')
      }
      if (curSurvivor.category !== 'theme' || curLoser.category !== 'theme') {
        throw new Error('BOTH_PAGES_MUST_BE_THEME')
      }
      if (curLoser.merged_into != null) {
        throw new Error('LOSER_ALREADY_MERGED')
      }

      const now = Date.now()
      // Use the transaction-reloaded titles, never the stale suggestion objects.
      const sTitle = curSurvivor.title
      const lTitle = curLoser.title

      // 2. Select the exact source rows before mutating them. Every subsequent
      // entry write is scoped by this ID set, so unrelated duplicate columns are
      // never touched.
      const match = await tx.execute(
        'SELECT DISTINCT id FROM entries WHERE LOWER(topic) = LOWER(?) OR LOWER(topic2) = LOWER(?)',
        [lTitle, lTitle]
      )
      entriesRepointed = match.rows.length
      const ids = match.rows.map((row) => String(row.id))
      const idPlaceholders = ids.map(() => '?').join(', ')
      // Each UPDATE is constrained to the snapshot of affected IDs. The
      // timestamp expression keeps the mutation and watermark in one write.
      await tx.execute(
        `UPDATE entries SET topic = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE LOWER(topic) = LOWER(?) AND id IN (${idPlaceholders})`,
        [sTitle, now, lTitle, ...ids]
      )
      await tx.execute(
        `UPDATE entries SET topic2 = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE LOWER(topic2) = LOWER(?) AND id IN (${idPlaceholders})`,
        [sTitle, now, lTitle, ...ids]
      )
      await tx.execute(
        `UPDATE entries SET topic2 = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE LOWER(topic) = LOWER(topic2) AND topic IS NOT NULL AND topic2 IS NOT NULL
           AND LENGTH(topic) > 0 AND id IN (${idPlaceholders})`,
        [now, ...ids]
      )

      // Queue exactly the rows selected above.
      for (const id of ids) {
        await enqueueUpsertInTransaction('entries', id, tx)
      }

      // 4. Flag the loser page as merged into the survivor.
      await tx.execute(
        'UPDATE wiki_pages SET merged_into = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
        [survivor.id, now, loser.id]
      )
      // Enqueue loser page
      await enqueueUpsertInTransaction('wiki_pages', loser.id, tx)

      // 5. Recompute the survivor's entry_count from distinct entries that now
      //    reference it, rather than blindly summing stale caller counts.
      const cntRes = await tx.execute(
        'SELECT COUNT(DISTINCT id) AS cnt FROM entries WHERE LOWER(topic) = LOWER(?) OR LOWER(topic2) = LOWER(?)',
        [sTitle, sTitle]
      )
      const newCount = Number(cntRes.rows[0]?.cnt ?? 0)
      await tx.execute(
        'UPDATE wiki_pages SET entry_count = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
        [newCount, now, survivor.id]
      )
      // Enqueue survivor page
      await enqueueUpsertInTransaction('wiki_pages', survivor.id, tx)

      // 6. Set the graph-rebuild repair marker inside the transaction. If the
      //    app is killed after commit but before the post-commit rebuild, this
      //    marker persists and bootstrap retries the graph rebuild on launch.
      await tx.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [GRAPH_REBUILD_REQUIRED_KEY, '1']
      )
    })

    // 7. Post-commit: rebuild the derived graph so the loser's nodes fold into
    //    the survivor's. A failure here does NOT roll back the merge — the
    //    durable repair marker guarantees retry on next launch.
    //    Use the same DB connection for the marker clear so tests injecting a
    //    fake DB don't fall back to the uninitialised global getDb().
    // Wake the debounced sync only after the merge transaction committed. The
    // direct queue writes above remain atomic with the source/page mutations.
    notifySyncPending()

    const graphResult = await rebuildGraph()
    let graphRebuilt = false
    if (graphResult.success) {
      await setSetting(GRAPH_REBUILD_REQUIRED_KEY, '0', db)
      graphRebuilt = true
    }

    return ok({ entriesRepointed, graphRebuilt })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    // Map known validation errors to structured codes so callers can distinguish
    // actual failures from expected rejections (stale/race merges).
    const code = msg === 'PAGE_NOT_FOUND' ? 'PAGE_MERGE_NOT_FOUND'
      : msg === 'SURVIVOR_DISMISSED' ? 'PAGE_MERGE_SURVIVOR_DISMISSED'
      : msg === 'LOSER_DISMISSED' ? 'PAGE_MERGE_LOSER_DISMISSED'
      : msg === 'BOTH_PAGES_MUST_BE_THEME' ? 'PAGE_MERGE_NOT_THEME'
      : msg === 'LOSER_ALREADY_MERGED' ? 'PAGE_MERGE_ALREADY_MERGED'
      : 'PAGE_MERGE_FAILED'
    return err(code, 'Failed to merge pages', e)
  }
}

/**
 * Check whether a graph rebuild is required (repair marker set). Called at
 * startup by bootstrap. Returns true when the marker is set to '1', meaning a
 * previous merge committed but the post-commit graph rebuild did not complete.
 */
export async function isGraphRebuildRequired(
  db: SqliteDatabase = getDb()
): Promise<boolean> {
  try {
    const res = await db.execute(
      'SELECT value FROM settings WHERE key = ?',
      [GRAPH_REBUILD_REQUIRED_KEY]
    )
    return res.rows.length > 0 && String(res.rows[0].value) === '1'
  } catch {
    return false
  }
}

/**
 * Clear the graph-rebuild repair marker after a successful rebuild. Called by
 * bootstrap after startup rebuildGraph() succeeds.
 */
export async function clearGraphRebuildMarker(
  db: SqliteDatabase = getDb()
): Promise<void> {
  try {
    await db.execute(
      'UPDATE settings SET value = ? WHERE key = ?',
      ['0', GRAPH_REBUILD_REQUIRED_KEY]
    )
  } catch {
    // best-effort — the next rebuild will see the marker and retry
  }
}
