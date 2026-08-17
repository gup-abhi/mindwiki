import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqlParam, type SqliteDatabase, getDb } from './db'
import { type EntityType } from './entities'
import { enqueueUpsertInTransaction, notifySyncPending } from './sync-queue'

/** Where an entry came from: the CBT journal flow, a Reflect-chat message, or a
 * guided-path answer. Only 'journal' shows in the timeline; the rest feed the
 * wiki/graph but stay out of it. */
export type EntrySource = 'journal' | 'reflect' | 'path'

export interface Entry {
  id: string
  created_at: number
  /** Mutable-record sync watermark. Present on all persisted rows after migration 029. */
  updated_at?: number
  mood: number
  situation: string
  thought: string
  behavior: string | null
  closing_note: string | null
  /** Model-inferred feeling — drives the graph + wiki. */
  emotion: string | null
  /** The feeling the user consciously named at capture (journal only). */
  named_emotion: string | null
  /** Arousal 1–5 (the grid's vertical axis); null for pre-grid entries. */
  energy: number | null
  distortion: string | null
  mood_score: number | null
  /** Primary theme (canonicalized, first of 1–2). Synced. */
  topic: string | null
  /** Secondary theme (canonicalized). Synced; null when only one theme. */
  topic2: string | null
  tagged_at: number | null
  /** When wiki synthesis for this entry last resolved. Set after (not before)
   * the deep-model wiki step so catch-up can find entries interrupted mid-
   * synthesis. Device-local — never synced. */
  wiki_indexed_at: number | null
  /** When this entry's graph contribution last landed. Parallel to
   * wiki_indexed_at; healed via a full rebuildGraph(). Device-local — never synced. */
  graph_indexed_at: number | null
  /** Reflect captures: the original chat message, kept for provenance when
   * `situation` holds the distilled restatement. Null for journal/path entries. */
  raw_text: string | null
  source: EntrySource
}

/** The CBT 5-step input. Steps 4 (behavior) and 5 (closing_note) are optional. */
export interface NewEntry {
  mood: number
  situation: string
  thought: string
  behavior?: string | null
  closing_note?: string | null
  /** The feeling the user named at capture; null for Reflect captures (no picker). */
  named_emotion?: string | null
  /** Arousal 1–5 from the capture grid; null for Reflect captures (no grid). */
  energy?: number | null
  /** Defaults to 'journal'. Reflect-chat captures pass 'reflect'. */
  source?: EntrySource
  /** Reflect captures: original chat message when situation is a distilled restatement. */
  raw_text?: string | null
}

/** Deep-model output applied after the entry is saved. */
export interface EntryTags {
  emotion: string
  distortion: string
  mood_score: number
  topic: string
  /** Second theme; empty string when only one. */
  topic2: string
}

function rowToEntry(row: Record<string, unknown>): Entry {
  const str = (v: unknown): string | null => (v == null ? null : String(v))
  const num = (v: unknown): number | null => (v == null ? null : Number(v))
  return {
    id: String(row.id),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at ?? row.created_at),
    mood: Number(row.mood),
    situation: String(row.situation),
    thought: String(row.thought),
    behavior: str(row.behavior),
    closing_note: str(row.closing_note),
    emotion: str(row.emotion),
    named_emotion: str(row.named_emotion),
    energy: num(row.energy),
    distortion: str(row.distortion),
    mood_score: num(row.mood_score),
    topic: str(row.topic),
    topic2: str(row.topic2),
    tagged_at: num(row.tagged_at),
    wiki_indexed_at: num(row.wiki_indexed_at),
    graph_indexed_at: num(row.graph_indexed_at),
    raw_text: str(row.raw_text),
    source: (row.source == null ? 'journal' : String(row.source)) as EntrySource,
  }
}

export async function createEntry(
  input: NewEntry,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry>> {
  const entry: Entry = {
    id: randomUUID(),
    created_at: Date.now(),
    updated_at: 0,
    mood: input.mood,
    situation: input.situation,
    thought: input.thought,
    behavior: input.behavior ?? null,
    closing_note: input.closing_note ?? null,
    emotion: null, // the model fills this after save
    named_emotion: input.named_emotion?.trim() || null,
    energy: input.energy ?? null,
    distortion: null,
    mood_score: null,
    topic: null,
    topic2: null,
    tagged_at: null,
    wiki_indexed_at: null,
    graph_indexed_at: null,
    raw_text: input.raw_text ?? null,
    source: input.source ?? 'journal',
  }
  entry.updated_at = entry.created_at
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO entries (id, created_at, updated_at, mood, situation, thought, behavior, closing_note, named_emotion, energy, raw_text, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.created_at,
          entry.updated_at ?? entry.created_at,
          entry.mood,
          entry.situation,
          entry.thought,
          entry.behavior,
          entry.closing_note,
          entry.named_emotion,
          entry.energy,
          entry.raw_text,
          entry.source,
        ]
      )
      await enqueueUpsertInTransaction('entries', entry.id, tx)
    })
    notifySyncPending()
    return ok(entry)
  } catch (e) {
    return err('ENTRY_CREATE_FAILED', 'Failed to create entry', e)
  }
}

export async function getEntry(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry | null>> {
  try {
    const res = await db.execute('SELECT * FROM entries WHERE id = ?', [id])
    const row = res.rows[0]
    return ok(row ? rowToEntry(row) : null)
  } catch (e) {
    return err('ENTRY_GET_FAILED', 'Failed to read entry', e)
  }
}

export async function listEntries(
  limit = 50,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry[]>> {
  try {
    // Journal timeline only — chat-derived ('reflect') entries feed the wiki/graph
    // but must never surface as journal entries.
    const res = await db.execute(
      "SELECT * FROM entries WHERE source = 'journal' ORDER BY created_at DESC LIMIT ?",
      [limit]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_LIST_FAILED', 'Failed to list entries', e)
  }
}

export interface EntryCursor {
  createdAt: number
  id: string
}

export interface JournalEntryPageOptions {
  limit?: number
  query?: string
  emotion?: string | null
  cursor?: EntryCursor | null
}

export interface JournalEntryPage {
  items: Entry[]
  nextCursor: EntryCursor | null
  hasMore: boolean
}

export interface JournalEntryNeighbors {
  older: Entry | null
  newer: Entry | null
}

// Keep archive search identical to former Home search: written journal fields only.
const SEARCH_COLUMNS = ['situation', 'thought', 'behavior', 'closing_note'] as const

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function archiveWhere(options: JournalEntryPageOptions): { clauses: string[]; params: (string | number | null)[] } {
  const clauses = ["source = 'journal'"]
  const params: (string | number | null)[] = []
  const query = options.query?.trim()
  if (query) {
    const pattern = `%${escapeLike(query)}%`
    clauses.push(`(${SEARCH_COLUMNS.map((column) => `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`).join(' OR ')})`)
    params.push(...SEARCH_COLUMNS.map(() => pattern))
  }
  if (options.emotion?.trim()) {
    clauses.push('emotion = ?')
    params.push(options.emotion.trim())
  }
  if (options.cursor) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))')
    params.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id)
  }
  return { clauses, params }
}

/** Paginated journal archive query. Ordering and cursor predicate are deliberately paired. */
export async function listJournalEntriesPage(
  options: JournalEntryPageOptions = {},
  db: SqliteDatabase = getDb()
): Promise<Result<JournalEntryPage>> {
  try {
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 30)))
    const where = archiveWhere(options)
    const res = await db.execute(
      `SELECT * FROM entries WHERE ${where.clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...where.params, limit + 1]
    )
    const rows = res.rows.map(rowToEntry)
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]
    return ok({
      items,
      hasMore,
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    })
  } catch (e) {
    return err('ENTRY_ARCHIVE_LIST_FAILED', 'Failed to list journal archive', e)
  }
}

export async function countJournalEntries(
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    const res = await db.execute("SELECT COUNT(*) AS n FROM entries WHERE source = 'journal'")
    return ok(Number(res.rows[0]?.n ?? 0))
  } catch (e) {
    return err('ENTRY_COUNT_FAILED', 'Failed to count journal entries', e)
  }
}

export async function listJournalEmotions(
  db: SqliteDatabase = getDb()
): Promise<Result<string[]>> {
  try {
    const res = await db.execute(
      "SELECT DISTINCT emotion FROM entries WHERE source = 'journal' AND emotion IS NOT NULL AND TRIM(emotion) <> '' ORDER BY emotion COLLATE NOCASE"
    )
    const seen = new Set<string>()
    const emotions: string[] = []
    for (const row of res.rows) {
      const value = String(row.emotion ?? '').trim()
      const key = value.toLowerCase()
      if (value && !seen.has(key)) {
        seen.add(key)
        emotions.push(value)
      }
    }
    return ok(emotions)
  } catch (e) {
    return err('ENTRY_EMOTIONS_FAILED', 'Failed to list journal emotions', e)
  }
}

async function getAdjacentJournalEntry(
  entry: Entry,
  newer: boolean,
  db: SqliteDatabase
): Promise<Entry | null> {
  const direction = newer ? 'ASC' : 'DESC'
  const predicate = newer
    ? '(created_at > ? OR (created_at = ? AND id > ?))'
    : '(created_at < ? OR (created_at = ? AND id < ?))'
  const res = await db.execute(
    `SELECT * FROM entries WHERE source = 'journal' AND ${predicate} ORDER BY created_at ${direction}, id ${direction} LIMIT 1`,
    [entry.created_at, entry.created_at, entry.id]
  )
  return res.rows[0] ? rowToEntry(res.rows[0]) : null
}

export async function getJournalEntryNeighbors(
  entry: Entry,
  db: SqliteDatabase = getDb()
): Promise<Result<JournalEntryNeighbors>> {
  try {
    const [older, newer] = await Promise.all([
      getAdjacentJournalEntry(entry, false, db),
      getAdjacentJournalEntry(entry, true, db),
    ])
    return ok({ older, newer })
  } catch (e) {
    return err('ENTRY_NEIGHBORS_FAILED', 'Failed to read journal entry neighbors', e)
  }
}

/**
 * Every entry that feeds the derived graph — journal + path (guided reflection)
 * + reflect (chat capture). Unlike listEntries (journal-only, for the timeline),
 * this is source-inclusive so rebuildGraph re-derives the SAME graph the live
 * pipeline builds: guided-path and chat-capture signal is first-class knowledge,
 * not timeline noise. Without this a rebuild (sync pull, dedupe, node restore)
 * would silently drop every node that only path/reflect entries supported.
 * Newest first with a stable `(created_at, id)` keyset so rebuilds can traverse
 * the complete source set without retaining every entry in memory.
 */
export interface GraphEntryCursor {
  createdAt: number
  id: string
}

export interface GraphEntryPage {
  items: Entry[]
  nextCursor: GraphEntryCursor | null
  hasMore: boolean
}

export interface GraphEntryPageOptions {
  limit?: number
  cursor?: GraphEntryCursor | null
}

/** Source-inclusive keyset pagination keeps graph rebuild memory bounded. */
export async function listEntriesForGraphPage(
  options: GraphEntryPageOptions = {},
  db: SqliteDatabase = getDb()
): Promise<Result<GraphEntryPage>> {
  try {
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 500)))
    const clauses = ['1 = 1']
    const params: SqlParam[] = []
    if (options.cursor) {
      clauses.push('(created_at < ? OR (created_at = ? AND id < ?))')
      params.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id)
    }
    const res = await db.execute(
      `SELECT * FROM entries WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, limit + 1]
    )
    const rows = res.rows.map(rowToEntry)
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]
    return ok({
      items,
      hasMore,
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    })
  } catch (e) {
    return err('ENTRY_GRAPH_LIST_FAILED', 'Failed to list entries for graph', e)
  }
}

/**
 * created_at (ms) for every entry that counts toward the streak — journal entries
 * and completed guided-path answers, but NOT incidental Reflect captures. Newest
 * first, capped. Lightweight: selects the timestamp column only, so it can look
 * back further than the timeline without hydrating rows.
 */
export async function listStreakTimestamps(
  limit = 400,
  db: SqliteDatabase = getDb()
): Promise<Result<number[]>> {
  try {
    const res = await db.execute(
      "SELECT created_at FROM entries WHERE source IN ('journal', 'path') ORDER BY created_at DESC LIMIT ?",
      [limit]
    )
    return ok(res.rows.map((r) => Number(r.created_at)))
  } catch (e) {
    return err('ENTRY_TIMESTAMPS_FAILED', 'Failed to list streak timestamps', e)
  }
}

/**
 * Entries that were saved but never indexed — `tagged_at` still null and they
 * have text worth extracting. This happens when a deep-model synthesis is cut
 * short (the app backgrounded/killed before the background index finished); on a
 * single device nothing else retries it. The launch-time catch-up re-indexes
 * these. Oldest-first so they fold into the compounding wiki in written order;
 * capped so a large backlog spreads over a few launches. The text filter skips
 * quick mood-logs, which are intentionally never tagged.
 */
export async function listUnindexedEntries(
  limit = 50,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry[]>> {
  try {
    const res = await db.execute(
      "SELECT * FROM entries WHERE tagged_at IS NULL AND (TRIM(situation) <> '' OR TRIM(thought) <> '') ORDER BY created_at ASC LIMIT ?",
      [limit]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_UNINDEXED_LIST_FAILED', 'Failed to list unindexed entries', e)
  }
}

/**
 * Entries that were tagged but whose wiki synthesis never completed (interrupted
 * mid-synthesis, since `tagged_at` is stamped before the fire-and-forget wiki
 * step). `listUnindexedEntries` misses these because they *are* tagged. The
 * launch-time catch-up re-runs *only* their wiki step (tags/entities already
 * persisted; graph is not re-run — additive edges would double-count). Oldest-
 * first, capped, same text filter as the tagged catch-up.
 */
export async function listWikiPendingEntries(
  limit = 50,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry[]>> {
  try {
    const res = await db.execute(
      "SELECT * FROM entries WHERE tagged_at IS NOT NULL AND wiki_indexed_at IS NULL AND (TRIM(situation) <> '' OR TRIM(thought) <> '') ORDER BY created_at ASC LIMIT ?",
      [limit]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_WIKI_PENDING_LIST_FAILED', 'Failed to list wiki-pending entries', e)
  }
}

/**
 * Stamp an entry's wiki synthesis as complete. Device-local bookkeeping for the
 * catch-up gate — deliberately does NOT enqueue a sync upsert (the column isn't
 * synced; wiki pages travel on their own).
 */
export async function markWikiIndexed(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute('UPDATE entries SET wiki_indexed_at = ? WHERE id = ?', [Date.now(), id])
    return ok(undefined)
  } catch (e) {
    return err('ENTRY_WIKI_MARK_FAILED', 'Failed to mark entry wiki-indexed', e)
  }
}

/**
 * Entries tagged but whose graph contribution never landed (interrupted before
 * the fire-and-forget graph step finished). Mirrors listWikiPendingEntries. The
 * launch-time catch-up heals these with a single rebuildGraph() rather than a
 * per-entry re-run — additive edges (ADR 006) make an un-tracked re-run double-
 * count, but a full rebuild is a clear + re-derive, so it's exactly-once.
 */
export async function listGraphPendingEntries(
  limit = 50,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry[]>> {
  try {
    const res = await db.execute(
      "SELECT * FROM entries WHERE tagged_at IS NOT NULL AND graph_indexed_at IS NULL AND (TRIM(situation) <> '' OR TRIM(thought) <> '') ORDER BY created_at ASC LIMIT ?",
      [limit]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_GRAPH_PENDING_LIST_FAILED', 'Failed to list graph-pending entries', e)
  }
}

/** Stamp one entry's graph contribution as landed. Device-local; not synced. */
export async function markGraphIndexed(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute('UPDATE entries SET graph_indexed_at = ? WHERE id = ?', [Date.now(), id])
    return ok(undefined)
  } catch (e) {
    return err('ENTRY_GRAPH_MARK_FAILED', 'Failed to mark entry graph-indexed', e)
  }
}

/**
 * Stamp EVERY tagged entry graph-indexed. Called by rebuildGraph on success: a
 * full rebuild folds all entries into the graph, so it clears the whole backlog
 * (and re-heals any entry whose graph_indexed_at a sync pull wiped). Device-local.
 */
export async function markAllGraphIndexed(db: SqliteDatabase = getDb()): Promise<Result<void>> {
  try {
    await db.execute(
      'UPDATE entries SET graph_indexed_at = ? WHERE tagged_at IS NOT NULL AND graph_indexed_at IS NULL',
      [Date.now()]
    )
    return ok(undefined)
  } catch (e) {
    return err('ENTRY_GRAPH_MARK_ALL_FAILED', 'Failed to mark all entries graph-indexed', e)
  }
}

/** Apply fast-model tags to an existing entry (never blocks the original save). */
export async function applyTags(
  id: string,
  tags: EntryTags,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    const now = Date.now()
    await db.transaction(async (tx) => {
      await tx.execute(
        'UPDATE entries SET emotion = ?, distortion = ?, mood_score = ?, topic = ?, topic2 = ?, tagged_at = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
        [tags.emotion, tags.distortion, tags.mood_score, tags.topic, tags.topic2, now, now, id]
      )
      await enqueueUpsertInTransaction('entries', id, tx)
    })
    notifySyncPending()
    return ok(undefined)
  } catch (e) {
    return err('ENTRY_TAG_FAILED', 'Failed to apply tags', e)
  }
}

/**
 * Count entries whose tag column equals `value` (case-insensitive) — the
 * recurrence gate for emotion/distortion/topic graph nodes, mirroring
 * countEntriesForEntity for entity nodes. Counts journal + reflect entries
 * (both feed the graph). `column` is a fixed internal literal, never user input.
 */
async function countEntriesByColumn(
  column: 'emotion' | 'distortion' | 'topic',
  value: string,
  db: SqliteDatabase
): Promise<Result<number>> {
  try {
    const res = await db.execute(
      `SELECT COUNT(*) AS n FROM entries WHERE ${column} = ? COLLATE NOCASE`,
      [value]
    )
    return ok(Number(res.rows[0]?.n ?? 0))
  } catch (e) {
    return err('ENTRY_TAG_COUNT_FAILED', 'Failed to count entries by tag', e)
  }
}

export function countEntriesByEmotion(label: string, db: SqliteDatabase = getDb()): Promise<Result<number>> {
  return countEntriesByColumn('emotion', label, db)
}

export function countEntriesByDistortion(label: string, db: SqliteDatabase = getDb()): Promise<Result<number>> {
  return countEntriesByColumn('distortion', label, db)
}

export function countEntriesByTopic(label: string, db: SqliteDatabase = getDb()): Promise<Result<number>> {
  return countEntriesByColumn('topic', label, db)
}

/**
 * Count entries whose topic OR topic2 equals `value` (case-insensitive) — the
 * recurrence gate for situation graph nodes. A secondary theme must count toward
 * the same label's recurrence so "Work" as a second topic reaches the gate as
 * fast as "Work" as the primary topic. Counts journal + reflect entries.
 */
export function countEntriesByAnyTopic(label: string, db: SqliteDatabase = getDb()): Promise<Result<number>> {
  return _countEntriesByOrColumn('topic', 'topic2', label, db)
}

async function _countEntriesByOrColumn(
  col1: string,
  col2: string,
  value: string,
  db: SqliteDatabase
): Promise<Result<number>> {
  try {
    const res = await db.execute(
      `SELECT COUNT(*) AS n FROM entries WHERE ${col1} = ? COLLATE NOCASE OR ${col2} = ? COLLATE NOCASE`,
      [value, value]
    )
    return ok(Number(res.rows[0]?.n ?? 0))
  } catch (e) {
    return err('ENTRY_TAG_COUNT_FAILED', 'Failed to count entries by tag', e)
  }
}

/**
 * List journal entries whose tag column equals `value` (case-insensitive),
 * newest first — the entries behind an emotion/distortion/situation graph node.
 * Reflect-chat entries are excluded (they never surface as journal entries).
 * `column` is a fixed internal literal, never user input.
 */
async function listEntriesByColumn(
  column: 'emotion' | 'distortion' | 'topic',
  value: string,
  db: SqliteDatabase,
  journalOnly = true
): Promise<Result<Entry[]>> {
  try {
    const sourceClause = journalOnly ? " AND source = 'journal'" : ''
    const res = await db.execute(
      `SELECT * FROM entries WHERE ${column} = ? COLLATE NOCASE${sourceClause} ORDER BY created_at DESC`,
      [value]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_LIST_BY_TAG_FAILED', 'Failed to list entries by tag', e)
  }
}

export function listEntriesByEmotion(label: string, db: SqliteDatabase = getDb()): Promise<Result<Entry[]>> {
  return listEntriesByColumn('emotion', label, db)
}

export function listEntriesByDistortion(label: string, db: SqliteDatabase = getDb()): Promise<Result<Entry[]>> {
  return listEntriesByColumn('distortion', label, db)
}

export function listEntriesByTopic(label: string, db: SqliteDatabase = getDb()): Promise<Result<Entry[]>> {
  return listEntriesByColumn('topic', label, db)
}

// --- Source-inclusive variants for graph node evidence ------------------------
// A graph node is derived from ALL sources (journal + reflect + path all run
// through the same indexFromExtract). The journal-only lists above power the wiki
// / trends surfaces; these power node-context, so tapping a node built purely
// from Reflect/path recurrence still shows the entries behind it (the UI labels
// them by source). Otherwise such a node lists nothing when tapped.

export function listEntriesByEmotionAllSources(label: string, db: SqliteDatabase = getDb()): Promise<Result<Entry[]>> {
  return listEntriesByColumn('emotion', label, db, false)
}

export function listEntriesByDistortionAllSources(label: string, db: SqliteDatabase = getDb()): Promise<Result<Entry[]>> {
  return listEntriesByColumn('distortion', label, db, false)
}

/**
 * List journal entries whose topic OR topic2 equals `value` (case-insensitive),
 * newest first — same as listEntriesByTopic but also matches the secondary topic
 * column. Needed for re-grounding a theme page (the page title may appear as
 * either the primary or secondary topic).
 */
export async function listEntriesByTopicOrTopic2(
  value: string,
  db: SqliteDatabase = getDb(),
  journalOnly = true
): Promise<Result<Entry[]>> {
  try {
    const sourceClause = journalOnly ? " AND source = 'journal'" : ''
    const res = await db.execute(
      `SELECT * FROM entries
        WHERE (topic = ? COLLATE NOCASE OR topic2 = ? COLLATE NOCASE)${sourceClause}
        ORDER BY created_at DESC`,
      [value, value]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_LIST_BY_TOPIC_FAILED', 'Failed to list entries by topic', e)
  }
}

/** Source-inclusive topic-or-topic2 list — the entries behind a situation node. */
export function listEntriesByAnyTopicAllSources(
  value: string,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry[]>> {
  return listEntriesByTopicOrTopic2(value, db, false)
}

/**
 * List journal entries that mention an entity (person/place/activity), newest
 * first — the entries behind a person/place/activity graph node. Reflect-chat
 * entries are excluded, matching listEntriesByColumn.
 */
export async function listEntriesForEntity(
  type: EntityType,
  label: string,
  db: SqliteDatabase = getDb(),
  journalOnly = true
): Promise<Result<Entry[]>> {
  try {
    // F-02B: list by EFFECTIVE label (COALESCE(canonical_label, label)) so a
    // canonicalized alias resolves to the same wiki lineage/entry list as its
    // canonical identity instead of fragmenting across the raw and canonical
    // labels.
    const sourceClause = journalOnly ? " AND e.source = 'journal'" : ''
    const res = await db.execute(
      `SELECT e.* FROM entries e
         JOIN entry_entities ee ON ee.entry_id = e.id
        WHERE ee.type = ? AND COALESCE(ee.canonical_label, ee.label) = ? COLLATE NOCASE${sourceClause}
        ORDER BY e.created_at DESC`,
      [type, label]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_LIST_BY_ENTITY_FAILED', 'Failed to list entries by entity', e)
  }
}

/** Source-inclusive entity list — the entries behind a person/place/activity/
 *  belief/behavior graph node (which derives from all sources). */
export function listEntriesForEntityAllSources(
  type: EntityType,
  label: string,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry[]>> {
  return listEntriesForEntity(type, label, db, false)
}

export async function deleteEntry(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute('DELETE FROM entries WHERE id = ?', [id])
    return ok(undefined)
  } catch (e) {
    return err('ENTRY_DELETE_FAILED', 'Failed to delete entry', e)
  }
}
