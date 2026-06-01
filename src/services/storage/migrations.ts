import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { migration001 } from './schema'

export interface Migration {
  version: number
  name: string
  statements: string[]
}

const CREATE_MIGRATIONS_TABLE =
  'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)'

/**
 * Apply any migrations whose version has not been recorded yet, in ascending
 * version order, each inside a transaction. Idempotent — re-running applies
 * nothing. Returns the versions applied this run.
 */
export async function runMigrations(
  db: SqliteDatabase,
  migrations: Migration[]
): Promise<Result<number[]>> {
  try {
    await db.execute(CREATE_MIGRATIONS_TABLE)

    const res = await db.execute('SELECT version FROM schema_migrations')
    const applied = new Set(res.rows.map((r) => Number(r.version)))

    const pending = migrations
      .filter((m) => !applied.has(m.version))
      .sort((a, b) => a.version - b.version)

    const appliedNow: number[] = []
    for (const migration of pending) {
      await db.transaction(async (tx) => {
        for (const statement of migration.statements) {
          await tx.execute(statement)
        }
        await tx.execute(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, Date.now()]
        )
      })
      appliedNow.push(migration.version)
    }

    return ok(appliedNow)
  } catch (e) {
    return err('MIGRATION_FAILED', 'Failed to run migrations', e)
  }
}

// Migration registry — append new migrations here, in version order.
export const MIGRATIONS: Migration[] = [migration001]

export function migrate(db: SqliteDatabase = getDb()): Promise<Result<number[]>> {
  return runMigrations(db, MIGRATIONS)
}
