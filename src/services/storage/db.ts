import { open } from '@op-engineering/op-sqlite'

import { type Result, ok, err } from '@/types/result'

// Minimal SQLite surface the storage layer depends on. op-sqlite's DB satisfies
// this structurally; keeping it as an interface decouples services from op-sqlite
// and lets them be unit-tested with an injected fake.
export type SqlParam = string | number | null

export interface QueryResult {
  rows: Array<Record<string, unknown>>
  rowsAffected: number
  insertId?: number
}

export interface SqliteDatabase {
  execute(sql: string, params?: SqlParam[]): Promise<QueryResult>
  transaction(fn: (tx: SqliteDatabase) => Promise<void>): Promise<void>
  close(): void
}

const DB_NAME = 'mindwiki.db'

let dbInstance: SqliteDatabase | null = null

/**
 * Open the encrypted database (SQLCipher via op-sqlite) and apply connection
 * PRAGMAs. The encryption key comes from the Keychain (CryptoModule) — never
 * hardcoded, never logged. Call once at app startup.
 */
export async function initDb(encryptionKey: string): Promise<Result<SqliteDatabase>> {
  try {
    const db = open({ name: DB_NAME, encryptionKey }) as unknown as SqliteDatabase
    await db.execute('PRAGMA journal_mode = WAL')
    await db.execute('PRAGMA foreign_keys = ON')
    dbInstance = db
    return ok(db)
  } catch (e) {
    return err('DB_INIT_FAILED', 'Failed to open encrypted database', e)
  }
}

export function getDb(): SqliteDatabase {
  if (!dbInstance) {
    throw new Error('Database not initialized — call initDb() first')
  }
  return dbInstance
}

/** Inject a database instance — for tests / dependency injection. */
export function setDb(db: SqliteDatabase | null): void {
  dbInstance = db
}

export function closeDb(): void {
  dbInstance?.close()
  dbInstance = null
}
