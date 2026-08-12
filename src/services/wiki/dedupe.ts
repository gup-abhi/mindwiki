import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { enqueueUpsertInTransaction, notifySyncPending } from '@/services/storage/sync-queue'
import { listPages } from '@/services/storage/wiki'
import { canonicalizeLabel, singularizeLabel } from '@/services/llm/taxonomy'
import { rebuildGraph } from '@/services/graph/engine'
import { type Result, ok, err } from '@/types/result'

/** The canonical (singular, title-cased) form a free-text topic collapses to. */
function canonicalTopic(raw: string): string {
  return singularizeLabel(canonicalizeLabel(raw))
}

/**
 * One-time cleanup for topics that fragmented before singularization existed.
 * Source and page mutations plus their outbox rows commit together; the graph is
 * derived and rebuilt only after that transaction commits.
 */
export async function dedupeTopics(
  db: SqliteDatabase = getDb()
): Promise<Result<{ entriesUpdated: number; pagesMerged: number }>> {
  try {
    let entriesUpdated = 0
    let pagesMerged = 0
    const changedEntryIds = new Set<string>()
    const changedPageIds = new Set<string>()

    await db.transaction(async (tx) => {
      const er = await tx.execute(
        "SELECT id, topic, topic2 FROM entries WHERE (topic IS NOT NULL AND topic <> '') OR (topic2 IS NOT NULL AND topic2 <> '')"
      )
      for (const row of er.rows) {
        const id = String(row.id)
        const current = row.topic ? String(row.topic) : null
        const next = current ? canonicalTopic(current) : null
        if (next && next !== current) {
          await tx.execute(
            'UPDATE entries SET topic = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
            [next, Date.now(), id]
          )
          changedEntryIds.add(id)
          entriesUpdated++
        }
        const current2 = row.topic2 ? String(row.topic2) : null
        const next2 = current2 ? canonicalTopic(current2) : null
        if (next2 && next2 !== current2) {
          await tx.execute(
            'UPDATE entries SET topic2 = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
            [next2, Date.now(), id]
          )
          changedEntryIds.add(id)
          entriesUpdated++
        }
      }
      for (const id of changedEntryIds) await enqueueUpsertInTransaction('entries', id, tx)

      const pr = await listPages(tx)
      if (!pr.success) throw new Error(pr.error.code)
      {
        const groups = new Map<string, typeof pr.data>()
        for (const p of pr.data) {
          if (p.category !== 'theme') continue
          const key = canonicalTopic(p.title).toLowerCase()
          const arr = groups.get(key) ?? []
          arr.push(p)
          groups.set(key, arr)
        }
        for (const pages of groups.values()) {
          if (pages.length < 2) continue
          const canonical = canonicalTopic(pages[0].title)
          pages.sort((a, b) => {
            const aCanon = a.title === canonical ? 1 : 0
            const bCanon = b.title === canonical ? 1 : 0
            return bCanon - aCanon || b.entry_count - a.entry_count || b.updated_at - a.updated_at
          })
          const survivor = pages[0]
          if (survivor.title !== canonical) {
            await tx.execute(
              'UPDATE wiki_pages SET title = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
              [canonical, Date.now(), survivor.id]
            )
            changedPageIds.add(survivor.id)
          }
          for (const dup of pages.slice(1)) {
            await tx.execute(
              'UPDATE wiki_pages SET merged_into = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
              [survivor.id, Date.now(), dup.id]
            )
            changedPageIds.add(dup.id)
            pagesMerged++
          }
        }
      }
      for (const id of changedPageIds) await enqueueUpsertInTransaction('wiki_pages', id, tx)
    })

    if (changedEntryIds.size > 0 || changedPageIds.size > 0) notifySyncPending()
    await rebuildGraph()
    return ok({ entriesUpdated, pagesMerged })
  } catch (e) {
    return err('TOPIC_DEDUPE_FAILED', 'Failed to dedupe topics', e)
  }
}
