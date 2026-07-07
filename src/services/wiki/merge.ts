import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { enqueueUpsert } from '@/services/storage/sync-queue'
import { rebuildGraph } from '@/services/graph/engine'
import { type WikiPage } from '@/services/storage/wiki'
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

export interface MergePair {
  /** The page the merge keeps (richer, then more recently updated). */
  survivor: WikiPage
  /** The page folded into the survivor. */
  loser: WikiPage
  similarity: number
}

/** Order-independent key for a page pair — for persisting "keep separate". */
export function pairKey(a: string, b: string): string {
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
      if (suppressed.has(pairKey(a.title, b.title))) continue
      const sim = cosine(vectors.get(a.id)!, vectors.get(b.id)!)
      if (sim < MERGE_THRESHOLD) continue
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
 * Consolidate two theme pages the user confirmed are the same theme. Unlike the
 * string dedupe, the pair shares no canonical title, so this must re-point the
 * loser's entries explicitly — otherwise the graph keeps a loser node and future
 * synthesis stays fragmented:
 *   1. Re-point every entry on the loser topic to the survivor's title (+ sync).
 *   2. Flag the loser page merged_into the survivor (hides it; existing
 *      machinery — not "dropped", so it never shows in Dropped insights).
 *   3. Fold the loser's entry_count into the survivor so richness/labels stay
 *      honest until the survivor re-grounds on its next entry.
 *   4. Rebuild the graph (nodes derive from entries.topic) so the loser folds.
 * Best-effort; never throws. The survivor re-synthesizes naturally on its next
 * entry — the re-pointed entries then count toward it.
 */
export async function mergePages(
  survivor: WikiPage,
  loser: WikiPage,
  db: SqliteDatabase = getDb()
): Promise<Result<{ entriesRepointed: number }>> {
  try {
    const now = Date.now()

    // 1. Re-point the loser's entries onto the survivor's topic.
    let entriesRepointed = 0
    const er = await db.execute('SELECT id, topic, topic2 FROM entries WHERE topic = ? OR topic2 = ?', [loser.title, loser.title])
    for (const row of er.rows) {
      const id = String(row.id)
      const curTopic = row.topic ? String(row.topic) : ''
      const curTopic2 = row.topic2 ? String(row.topic2) : ''
      // If topic equals the loser, replace it; otherwise it's topic2, replace that.
      if (curTopic.toLowerCase() === loser.title.toLowerCase()) {
        if (survivor.title !== curTopic) {
          await db.execute('UPDATE entries SET topic = ? WHERE id = ?', [survivor.title, id])
          await enqueueUpsert('entries', id, db)
          entriesRepointed++
        }
      } else if (curTopic2.toLowerCase() === loser.title.toLowerCase()) {
        if (survivor.title !== curTopic2) {
          await db.execute('UPDATE entries SET topic2 = ? WHERE id = ?', [survivor.title, id])
          await enqueueUpsert('entries', id, db)
          entriesRepointed++
        }
      }
    }

    // 2. Flag the loser as merged into the survivor.
    await db.execute('UPDATE wiki_pages SET merged_into = ?, updated_at = ? WHERE id = ?', [
      survivor.id,
      now,
      loser.id,
    ])
    await enqueueUpsert('wiki_pages', loser.id, db)

    // 3. Fold the loser's entry_count into the survivor.
    await db.execute('UPDATE wiki_pages SET entry_count = ?, updated_at = ? WHERE id = ?', [
      survivor.entry_count + loser.entry_count,
      now,
      survivor.id,
    ])
    await enqueueUpsert('wiki_pages', survivor.id, db)

    // 4. Graph nodes derive from entries.topic — rebuild so the loser folds.
    await rebuildGraph()
    return ok({ entriesRepointed })
  } catch (e) {
    return err('PAGE_MERGE_FAILED', 'Failed to merge pages', e)
  }
}
