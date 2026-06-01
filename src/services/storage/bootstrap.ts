import { CryptoModule } from '@/native/CryptoModule'
import { type Result, ok, err } from '@/types/result'

import { initDb } from './db'
import { migrate } from './migrations'

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

  const opened = await initDb(key)
  if (!opened.success) return opened

  const migrated = await migrate()
  if (!migrated.success) return migrated

  return ok(undefined)
}
