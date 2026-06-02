import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'

/** Read a settings value by key, or null when unset. */
export async function getSetting(
  key: string,
  db: SqliteDatabase = getDb()
): Promise<Result<string | null>> {
  try {
    const res = await db.execute('SELECT value FROM settings WHERE key = ?', [key])
    const row = res.rows[0]
    return ok(row ? String(row.value) : null)
  } catch (e) {
    return err('SETTINGS_GET_FAILED', 'Failed to read setting', e)
  }
}

/** Upsert a settings value by key. */
export async function setSetting(
  key: string,
  value: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
    return ok(undefined)
  } catch (e) {
    return err('SETTINGS_SET_FAILED', 'Failed to write setting', e)
  }
}
