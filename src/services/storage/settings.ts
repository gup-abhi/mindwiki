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

/** Atomically increment a numeric setting and reset it when threshold is met.
 * The read, decision, and write share one SQLite transaction, so concurrent
 * background indexers cannot lose increments or both observe the crossing. */
export async function incrementSettingToThreshold(
  key: string,
  threshold: number,
  db: SqliteDatabase = getDb()
): Promise<Result<boolean>> {
  try {
    let reached = false
    await db.transaction(async (tx) => {
      const res = await tx.execute('SELECT value FROM settings WHERE key = ?', [key])
      const current = res.rows[0] ? Number(res.rows[0].value) : 0
      const next = Number.isFinite(current) ? current + 1 : 1
      reached = next >= threshold
      await tx.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(reached ? 0 : next)]
      )
    })
    return ok(reached)
  } catch (e) {
    return err('SETTINGS_INCREMENT_FAILED', 'Failed to increment setting', e)
  }
}

/** Atomically increment a numeric setting by 1. The read, decision, and write
 * share one SQLite transaction, so concurrent callers cannot lose increments
 * (no two writers can both observe the same pre-increment value). Used by
 * count-only local diagnostics that want a monotonic total. */
export async function bumpSetting(
  key: string,
  db: SqliteDatabase = getDb()
): Promise<Result<number>> {
  try {
    let next = 1
    await db.transaction(async (tx) => {
      const res = await tx.execute('SELECT value FROM settings WHERE key = ?', [key])
      const current = res.rows[0] ? Number(res.rows[0].value) : 0
      next = (Number.isFinite(current) ? current : 0) + 1
      await tx.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(next)]
      )
    })
    return ok(next)
  } catch (e) {
    return err('SETTINGS_BUMP_FAILED', 'Failed to bump setting', e)
  }
}
