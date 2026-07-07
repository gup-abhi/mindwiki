import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { enqueueUpsert } from '@/services/storage/sync-queue'
import { listPages } from '@/services/storage/wiki'
import { canonicalizeLabel, singularizeLabel } from '@/services/llm/taxonomy'
import { rebuildGraph } from '@/services/graph/engine'
import { type Result, ok, err } from '@/types/result'

/** The canonical (singular, title-cased) form a free-text topic collapses to. */
function canonicalTopic(raw: string): string {
  return singularizeLabel(canonicalizeLabel(raw))
}

/**
 * One-time cleanup for topics that fragmented before singularization existed
 * (e.g. "relationship" + "relationships" as two pages/nodes):
 *   1. Re-derive every entry's `topic` to its singular canonical form.
 *   2. Merge active theme wiki pages that collapse to the same topic — keep the
 *      richest as survivor (retitled to the canonical form) and mark the rest
 *      merged_into it (consolidated, not user-dropped — so they don't show in
 *      "Dropped insights"; nothing is deleted).
 *   3. Rebuild the graph (derived from entries.topic) so nodes collapse too.
 * Only `theme` pages are touched — never emotion/distortion (controlled vocab)
 * or person/place (proper nouns). Best-effort; never throws.
 */
export async function dedupeTopics(
  db: SqliteDatabase = getDb()
): Promise<Result<{ entriesUpdated: number; pagesMerged: number }>> {
  try {
    // 1. Re-derive entries.topic and entries.topic2 to the singular canonical form.
    let entriesUpdated = 0
    const er = await db.execute("SELECT id, topic, topic2 FROM entries WHERE (topic IS NOT NULL AND topic <> '') OR (topic2 IS NOT NULL AND topic2 <> '')")
    for (const row of er.rows) {
      const id = String(row.id)
      const current = row.topic ? String(row.topic) : null
      const next = current ? canonicalTopic(current) : null
      if (next && next !== current) {
        await db.execute('UPDATE entries SET topic = ? WHERE id = ?', [next, id])
        await enqueueUpsert('entries', id, db)
        entriesUpdated++
      }
      const current2 = row.topic2 ? String(row.topic2) : null
      const next2 = current2 ? canonicalTopic(current2) : null
      if (next2 && next2 !== current2) {
        await db.execute('UPDATE entries SET topic2 = ? WHERE id = ?', [next2, id])
        await enqueueUpsert('entries', id, db)
        entriesUpdated++
      }
    }

    // 2. Merge active theme pages that collapse to the same canonical topic.
    let pagesMerged = 0
    const pr = await listPages(db)
    if (pr.success) {
      const groups = new Map<string, typeof pr.data>()
      for (const p of pr.data) {
        if (p.category !== 'theme') continue // only free-text themes singularize
        const key = canonicalTopic(p.title).toLowerCase()
        const arr = groups.get(key) ?? []
        arr.push(p)
        groups.set(key, arr)
      }
      for (const pages of groups.values()) {
        if (pages.length < 2) continue
        // All pages in a group collapse to the same canonical title.
        const canonical = canonicalTopic(pages[0].title)
        // Prefer a page already titled canonically; otherwise the richest, then
        // most-recently-updated — so the survivor is the natural home.
        pages.sort((a, b) => {
          const aCanon = a.title === canonical ? 1 : 0
          const bCanon = b.title === canonical ? 1 : 0
          return bCanon - aCanon || b.entry_count - a.entry_count || b.updated_at - a.updated_at
        })
        const survivor = pages[0]
        if (survivor.title !== canonical) {
          await db.execute('UPDATE wiki_pages SET title = ?, updated_at = ? WHERE id = ?', [
            canonical,
            Date.now(),
            survivor.id,
          ])
          await enqueueUpsert('wiki_pages', survivor.id, db)
        }
        for (const dup of pages.slice(1)) {
          await db.execute('UPDATE wiki_pages SET merged_into = ?, updated_at = ? WHERE id = ?', [
            survivor.id,
            Date.now(),
            dup.id,
          ])
          await enqueueUpsert('wiki_pages', dup.id, db)
          pagesMerged++
        }
      }
    }

    // 3. The graph is derived from entries.topic — rebuild so its nodes collapse.
    await rebuildGraph()
    return ok({ entriesUpdated, pagesMerged })
  } catch (e) {
    return err('TOPIC_DEDUPE_FAILED', 'Failed to dedupe topics', e)
  }
}
