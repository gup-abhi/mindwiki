import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsert } from './sync-queue'

export interface Entry {
  id: string
  created_at: number
  mood: number
  situation: string
  thought: string
  behavior: string | null
  closing_note: string | null
  emotion: string | null
  distortion: string | null
  mood_score: number | null
  /** Fast-model theme (1–3 words) — persisted so the graph rebuilds across devices. */
  topic: string | null
  tagged_at: number | null
}

/** The CBT 5-step input. Steps 4 (behavior) and 5 (closing_note) are optional. */
export interface NewEntry {
  mood: number
  situation: string
  thought: string
  behavior?: string | null
  closing_note?: string | null
}

/** Fast-model output applied after the entry is saved. */
export interface EntryTags {
  emotion: string
  distortion: string
  mood_score: number
  topic: string
}

function rowToEntry(row: Record<string, unknown>): Entry {
  const str = (v: unknown): string | null => (v == null ? null : String(v))
  const num = (v: unknown): number | null => (v == null ? null : Number(v))
  return {
    id: String(row.id),
    created_at: Number(row.created_at),
    mood: Number(row.mood),
    situation: String(row.situation),
    thought: String(row.thought),
    behavior: str(row.behavior),
    closing_note: str(row.closing_note),
    emotion: str(row.emotion),
    distortion: str(row.distortion),
    mood_score: num(row.mood_score),
    topic: str(row.topic),
    tagged_at: num(row.tagged_at),
  }
}

export async function createEntry(
  input: NewEntry,
  db: SqliteDatabase = getDb()
): Promise<Result<Entry>> {
  const entry: Entry = {
    id: randomUUID(),
    created_at: Date.now(),
    mood: input.mood,
    situation: input.situation,
    thought: input.thought,
    behavior: input.behavior ?? null,
    closing_note: input.closing_note ?? null,
    emotion: null,
    distortion: null,
    mood_score: null,
    topic: null,
    tagged_at: null,
  }
  try {
    await db.execute(
      `INSERT INTO entries (id, created_at, mood, situation, thought, behavior, closing_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.created_at,
        entry.mood,
        entry.situation,
        entry.thought,
        entry.behavior,
        entry.closing_note,
      ]
    )
    await enqueueUpsert('entries', entry.id, db) // best-effort; never blocks the save
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
    const res = await db.execute(
      'SELECT * FROM entries ORDER BY created_at DESC LIMIT ?',
      [limit]
    )
    return ok(res.rows.map(rowToEntry))
  } catch (e) {
    return err('ENTRY_LIST_FAILED', 'Failed to list entries', e)
  }
}

/** Apply fast-model tags to an existing entry (never blocks the original save). */
export async function applyTags(
  id: string,
  tags: EntryTags,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute(
      'UPDATE entries SET emotion = ?, distortion = ?, mood_score = ?, topic = ?, tagged_at = ? WHERE id = ?',
      [tags.emotion, tags.distortion, tags.mood_score, tags.topic, Date.now(), id]
    )
    await enqueueUpsert('entries', id, db) // tagging changes the row → re-sync
    return ok(undefined)
  } catch (e) {
    return err('ENTRY_TAG_FAILED', 'Failed to apply tags', e)
  }
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
