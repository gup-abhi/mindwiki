import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsert } from './sync-queue'

export interface WikiPageVersion {
  version: number
  content: string
  updated_at: number
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
}

export interface NewWikiPage {
  title: string
  category?: string | null
  content?: string
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
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    dismissed_at: row.dismissed_at == null ? null : Number(row.dismissed_at),
    corrected_at: row.corrected_at == null ? null : Number(row.corrected_at),
  }
}

export async function createPage(
  input: NewWikiPage,
  db: SqliteDatabase = getDb()
): Promise<Result<WikiPage>> {
  const now = Date.now()
  const page: WikiPage = {
    id: randomUUID(),
    title: input.title,
    category: input.category ?? null,
    content: input.content ?? '',
    entry_count: 0,
    version: 1,
    version_history: [],
    created_at: now,
    updated_at: now,
    dismissed_at: null,
    corrected_at: null,
  }
  try {
    await db.execute(
      `INSERT INTO wiki_pages
         (id, title, category, content, entry_count, version, version_history, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [page.id, page.title, page.category, page.content, 0, 1, '[]', now, now]
    )
    await enqueueUpsert('wiki_pages', page.id, db) // best-effort; never blocks
    return ok(page)
  } catch (e) {
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
    const res = await db.execute('SELECT * FROM wiki_pages WHERE title = ?', [title])
    const row = res.rows[0]
    return ok(row ? rowToPage(row) : null)
  } catch (e) {
    return err('WIKI_GET_FAILED', 'Failed to read wiki page', e)
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
      'SELECT * FROM wiki_pages WHERE dismissed_at IS NULL ORDER BY updated_at DESC'
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
      'SELECT * FROM wiki_pages WHERE dismissed_at IS NOT NULL ORDER BY dismissed_at DESC'
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
    const res = await db.execute('UPDATE wiki_pages SET dismissed_at = ? WHERE id = ?', [
      Date.now(),
      id,
    ])
    if ((res.rowsAffected ?? 0) === 0) return err('WIKI_NOT_FOUND', 'Wiki page not found')
    await enqueueUpsert('wiki_pages', id, db)
    return ok(undefined)
  } catch (e) {
    return err('WIKI_DISMISS_FAILED', 'Failed to dismiss wiki page', e)
  }
}

/** Restore a previously dropped page. */
export async function restorePage(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    const res = await db.execute('UPDATE wiki_pages SET dismissed_at = NULL WHERE id = ?', [id])
    if ((res.rowsAffected ?? 0) === 0) return err('WIKI_NOT_FOUND', 'Wiki page not found')
    await enqueueUpsert('wiki_pages', id, db)
    return ok(undefined)
  } catch (e) {
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
    const current = await getPage(id, db)
    if (!current.success) return current
    if (current.data == null) {
      return err('WIKI_NOT_FOUND', 'Wiki page not found')
    }

    const prev = current.data
    const history: WikiPageVersion[] = [
      ...prev.version_history,
      { version: prev.version, content: prev.content, updated_at: prev.updated_at },
    ]
    const now = Date.now()
    const next: WikiPage = {
      ...prev,
      content,
      version: prev.version + 1,
      version_history: history,
      entry_count: prev.entry_count + 1,
      updated_at: now,
      // A fresh synthesis heals a previously-dropped page: clear the flag so it
      // rejoins retrieval (the engine regenerates its content from scratch). It
      // also supersedes a user correction — the content now folds in a new entry,
      // so it's no longer purely the user's words.
      dismissed_at: null,
      corrected_at: null,
    }

    await db.execute(
      `UPDATE wiki_pages
         SET content = ?, version = ?, version_history = ?, entry_count = ?, updated_at = ?,
             dismissed_at = NULL, corrected_at = NULL
       WHERE id = ?`,
      [next.content, next.version, JSON.stringify(history), next.entry_count, now, id]
    )
    await enqueueUpsert('wiki_pages', id, db) // content changed → re-sync
    return ok(next)
  } catch (e) {
    return err('WIKI_UPDATE_FAILED', 'Failed to update wiki page', e)
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
    const history: WikiPageVersion[] = [
      ...prev.version_history,
      { version: prev.version, content: prev.content, updated_at: prev.updated_at },
    ]
    const now = Date.now()
    const next: WikiPage = {
      ...prev,
      content,
      version: prev.version + 1,
      version_history: history,
      updated_at: now,
      corrected_at: now,
      dismissed_at: null,
    }

    await db.execute(
      `UPDATE wiki_pages
         SET content = ?, version = ?, version_history = ?, updated_at = ?,
             corrected_at = ?, dismissed_at = NULL
       WHERE id = ?`,
      [next.content, next.version, JSON.stringify(history), now, now, id]
    )
    await enqueueUpsert('wiki_pages', id, db) // content changed → re-sync
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
    const history: WikiPageVersion[] = [
      ...prev.version_history,
      { version: prev.version, content: prev.content, updated_at: prev.updated_at },
    ]
    const now = Date.now()
    const next: WikiPage = {
      ...prev,
      content,
      version: prev.version + 1,
      version_history: history,
      updated_at: now,
      corrected_at: null,
    }

    await db.execute(
      `UPDATE wiki_pages
         SET content = ?, version = ?, version_history = ?, updated_at = ?, corrected_at = NULL
       WHERE id = ?`,
      [next.content, next.version, JSON.stringify(history), now, id]
    )
    await enqueueUpsert('wiki_pages', id, db) // content changed → re-sync
    return ok(next)
  } catch (e) {
    return err('WIKI_REGEN_FAILED', 'Failed to regenerate wiki page', e)
  }
}
