import { type Result, ok, err } from '@/types/result'
import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { getSetting, setSetting } from '@/services/storage/settings'
import { enqueueUpsert, notifySyncPending } from '@/services/storage/sync-queue'
import { type WikiPage, type WikiPageVersion } from '@/services/storage/wiki'

export const LEGACY_WIKI_BACKFILL_KEY = 'maintenance:wiki_empty_v1_v2'

export function isLegacyEmptyV1(
  page: Pick<WikiPage, 'category' | 'content' | 'version' | 'version_history'>
): boolean {
  if (page.version < 2) return false
  const v1 = page.version_history.find((v) => v.version === 1)
  const hasLaterContent =
    page.content.trim() !== '' ||
    page.version_history.some((v) => v.version > 1 && v.content.trim() !== '')
  return v1 != null && v1.content.trim() === '' && hasLaterContent
}

export function repairLegacyPage<
  T extends Pick<WikiPage, 'category' | 'content' | 'version' | 'version_history'>
>(
  page: T
): T | null {
  if (!isLegacyEmptyV1(page)) return null
  return {
    ...page,
    version: page.version - 1,
    version_history: page.version_history
      .filter((v) => !(v.version === 1 && v.content.trim() === ''))
      .map((v) => ({ ...v, version: v.version - 1 })),
  }
}

export function repairLegacyRow(row: Record<string, unknown>): Record<string, unknown> | null {
  let history: WikiPageVersion[]
  try {
    const parsed = JSON.parse(String(row.version_history ?? '[]'))
    if (!Array.isArray(parsed)) return null
    history = parsed as WikiPageVersion[]
  } catch {
    return null
  }
  const repaired = repairLegacyPage({
    category: row.category == null ? null : String(row.category),
    version: Number(row.version ?? 1),
    content: String(row.content ?? ''),
    version_history: history,
  })
  return repaired ? { ...row, version: repaired.version, version_history: JSON.stringify(repaired.version_history) } : null
}

/** Repair local rows once. Transaction includes queue rows so repair cannot commit without sync. */
export async function backfillLegacyWikiPages(
  db: SqliteDatabase = getDb(),
  force = false
): Promise<Result<number>> {
  try {
    const done = await getSetting(LEGACY_WIKI_BACKFILL_KEY, db)
    if (!force && done.success && done.data === '1') return ok(0)

    let repaired = 0
    await db.transaction(async (tx) => {
      const rows = await tx.execute('SELECT * FROM wiki_pages')
      for (const row of rows.rows) {
        const page = repairLegacyRow(row)
        if (!page) continue
        const updatedAt = Math.max((Number(row.updated_at) || 0) + 1, Date.now())
        await tx.execute(
          `UPDATE wiki_pages SET version = ?, version_history = ?, updated_at = ? WHERE id = ?`,
          [Number(page.version), String(page.version_history), updatedAt, String(row.id)]
        )
        const queued = await enqueueUpsert('wiki_pages', String(row.id), tx, false)
        if (!queued.success) throw new Error(queued.error.code)
        repaired++
      }
      await setSetting(LEGACY_WIKI_BACKFILL_KEY, '1', tx)
    })
    if (repaired > 0) notifySyncPending()
    return ok(repaired)
  } catch (e) {
    return err('WIKI_LEGACY_BACKFILL_FAILED', 'Failed to repair legacy wiki pages', e)
  }
}