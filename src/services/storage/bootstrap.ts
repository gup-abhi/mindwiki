import { CryptoModule } from '@/native/CryptoModule'
import { rebuildGraph } from '@/services/graph/engine'
import { dedupeTopics } from '@/services/wiki/dedupe'
import { type AppError, type Result, ok, err } from '@/types/result'

import { initDb, deleteDatabase } from './db'
import { migrate } from './migrations'
import { getSetting, setSetting } from './settings'

/**
 * True when opening the DB failed because the file can't be decrypted with the
 * current key — a foreign DB left by a previous account (logout's wipe was
 * missed) or genuine corruption. SQLCipher reports this as an hmac/"not a
 * database"/decrypt error. Deliberately narrow: a transient or IO failure (disk
 * full, permissions) must NOT match, or we'd wipe good data over a blip.
 */
function isDecryptFailure(error: AppError): boolean {
  const cause = String(error.cause ?? '').toLowerCase()
  return /hmac|not a database|file is encrypted|decrypt|notadb/.test(cause)
}

// One-time topic de-duplication (collapse plural/singular wiki pages + nodes).
// Guarded by a settings flag so it runs once per device, after singularization
// shipped. Bumping the suffix would re-run it.
const DEDUPE_TOPICS_FLAG = 'maintenance:dedupe_topics_v1'

/**
 * App-startup storage init: fetch the master key from the keystore, open the
 * encrypted database, then run pending migrations. Call once before any storage
 * use. Returns Result — the caller decides how to surface failure.
 */
export async function initStorage(): Promise<Result<void>> {
  let key: string
  try {
    key = await CryptoModule.getKeyFromKeychain()
  } catch (e) {
    return err('STORAGE_KEY_FAILED', 'Could not obtain the database key', e)
  }

  let opened = await initDb(key)
  if (!opened.success) {
    // Self-heal a foreign/corrupt DB: it can never be read with the current key,
    // so wipe it and recreate an empty one. The server is the E2E source of truth
    // and sync re-pulls the account's data. Without this, a stale DB from a
    // previous account (whose logout wipe was missed) bricks every launch.
    if (!isDecryptFailure(opened.error)) return opened
    deleteDatabase()
    opened = await initDb(key)
    if (!opened.success) return opened
  }

  const migrated = await migrate()
  if (!migrated.success) return migrated

  // Migration 003 recreates the derived graph tables (to widen the node-type
  // CHECK), which empties them. Rebuild from entries + entry_entities so a
  // single-device user (who never pulls a sync delta) doesn't lose their graph.
  // Best-effort — a rebuild failure must not block storage init.
  if (migrated.data.includes(3)) await rebuildGraph()

  // One-time cleanup of pre-singularization topic duplicates. Runs once (flag),
  // best-effort — a failure must not block storage init, and it'll retry next
  // launch since the flag is only set on success.
  const deduped = await getSetting(DEDUPE_TOPICS_FLAG)
  if (!(deduped.success && deduped.data)) {
    const res = await dedupeTopics()
    if (res.success) await setSetting(DEDUPE_TOPICS_FLAG, '1')
  }

  return ok(undefined)
}
