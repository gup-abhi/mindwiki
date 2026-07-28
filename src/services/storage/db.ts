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
  /** op-sqlite: close the connection and remove the underlying DB file. */
  delete?(): void
}

const DB_NAME = 'mindwiki.db'

let dbInstance: SqliteDatabase | null = null

// Wipe guard (I5, docs/AUTH_DB_LIFECYCLE.md): set for the duration of a logout
// wipe so no background work (sync, LLM pipeline) can grab the DB handle while
// it's being deleted. getDb() fails closed while set; callers that Result-wrap
// getDb() degrade to an error instead of touching a half-deleted native handle.
let wiping = false

export function beginWipe(): void {
  wiping = true
}

export function endWipe(): void {
  wiping = false
}

export function isWiping(): boolean {
  return wiping
}

/**
 * Open the encrypted database (SQLCipher via op-sqlite) and apply connection
 * PRAGMAs. The encryption key comes from the Keychain (CryptoModule) — never
 * hardcoded, never logged. Call once at app startup.
 */
export async function initDb(encryptionKey: string): Promise<Result<SqliteDatabase>> {
  let db: SqliteDatabase | undefined
  try {
    // op-sqlite's open() is lazy — it doesn't decrypt any pages until the first
    // query, so a wrong key surfaces here, on the first PRAGMA, not on open().
    db = open({ name: DB_NAME, encryptionKey }) as unknown as SqliteDatabase
    await db.execute('PRAGMA journal_mode = WAL')
    await db.execute('PRAGMA foreign_keys = ON')
    dbInstance = db
    return ok(db)
  } catch (e) {
    // Don't leak the lazily-opened native connection when the key doesn't match
    // — the self-heal path is about to delete this file and reopen.
    db?.close()
    return err('DB_INIT_FAILED', 'Failed to open encrypted database', e)
  }
}

export function getDb(): SqliteDatabase {
  // Fail closed during a wipe (I5): the handle is about to be deleted, so refuse
  // to hand it out rather than let a background caller run against it.
  if (wiping) {
    throw new Error('Database is being wiped')
  }
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

/**
 * Delete the encrypted database file from disk and drop the singleton, so the
 * next initDb() recreates an empty DB keyed to whatever master key is current.
 * Used on logout (account isolation: a different account must never inherit the
 * previous account's local data — the old file is keyed with the old master key
 * and cannot be reused) and by the storage self-heal when a foreign DB is found.
 *
 * Must delete the FILE, not just close a handle: in a dev build a JS reload
 * resets `dbInstance` to null, and after that the old code deleted nothing and
 * the stale file survived to brick the next login. When there's no live handle
 * we open a throwaway one — op-sqlite's open() is lazy, so this removes the file
 * (and its -wal/-shm) without needing the matching key.
 */
export function deleteDatabase(): boolean {
  const live = dbInstance
  dbInstance = null
  try {
    if (live?.delete) {
      live.delete()
      return true
    }
    live?.close()
    const handle = open({ name: DB_NAME }) as unknown as SqliteDatabase
    handle.delete?.()
    return true
  } catch {
    // Caller retains wipe marker when native deletion fails.
    return false
  }
}
