import { CryptoModule } from '@/native/CryptoModule'
import { rebuildGraph } from '@/services/graph/engine'
import { clearTokens, getTokens } from '@/services/auth/token-store'
import { dedupeTopics } from '@/services/wiki/dedupe'
import { catchUpUnindexed } from '@/services/pipeline'
import { isGraphRebuildRequired, clearGraphRebuildMarker } from '@/services/wiki/merge'
import { maybeRefreshEmotionPages, scanReGroundDuePages } from '@/services/wiki/engine'
import {
  retryBeliefMaintenanceGraphRebuild,
  runBeliefMaintenance,
} from '@/services/wiki/belief-maintenance'
import { isModelDownloaded } from '@/services/llm/model-manager'
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

let maintenanceFlight: Promise<void> | null = null

/** Run inference-dependent repairs once per process. Never blocks DB startup. */
function runStartupMaintenance(): Promise<void> {
  if (maintenanceFlight) return maintenanceFlight
  maintenanceFlight = (async () => {
    try {
      const mergeNeeds = await isGraphRebuildRequired()
      if (mergeNeeds) {
        const graphRetry = await rebuildGraph()
        if (graphRetry.success) await clearGraphRebuildMarker()
      }
      const retry = await retryBeliefMaintenanceGraphRebuild()
      if (!retry.success) return
      if (await isModelDownloaded('embed')) {
        await runBeliefMaintenance()
      }
      if (await isModelDownloaded('deep')) {
        await scanReGroundDuePages()
      }
    } catch {
      // Best-effort. Durable markers/watermarks remain pending for next launch.
    }
  })().finally(() => {
    maintenanceFlight = null
  })
  return maintenanceFlight
}

/**
 * App-startup storage init: fetch the master key from the keystore, open the
 * encrypted database, then run pending migrations. Call once before any storage
 * use. Returns Result — the caller decides how to surface failure.
 */
export async function initStorage(): Promise<Result<void>> {
  // Explicit key-ownership check (R3, docs/AUTH_DB_LIFECYCLE.md): if the key in
  // the keystore was installed for a different account than the one whose session
  // we hold, this is an inherited-key state — the foreign DB would decrypt cleanly
  // under the shared key, so decrypt-failure self-heal (below) can't catch it.
  // Wipe key + DB + tokens and fail to the login screen. Only fires when BOTH the
  // owner marker and the session accountId are present and disagree; a missing
  // owner marker (pre-R3 installs) is tolerated and left to the self-heal backstop.
  const [owner, tokens] = await Promise.all([CryptoModule.getKeyOwner(), getTokens()])
  if (owner && tokens && owner !== tokens.accountId) {
    deleteDatabase()
    await CryptoModule.deleteKeyFromKeychain()
    await CryptoModule.deleteKeyOwner()
    await clearTokens()
    return err('STORAGE_FOREIGN_KEY', 'Database key belongs to a different account')
  }

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

  // Migrations 003 and 028 recreate the derived graph tables (003 widened the
  // node-type CHECK; 028 made `label` COLLATE NOCASE), which empties them. Rebuild
  // from entries + entry_entities so a single-device user (who never pulls a sync
  // delta) doesn't lose their graph. Best-effort — a rebuild failure must not
  // block storage init; the next launch's catch-up heals it.
  if (migrated.data.includes(3) || migrated.data.includes(28)) await rebuildGraph()

  // One-time cleanup of pre-singularization topic duplicates. Runs once (flag),
  // best-effort — a failure must not block storage init, and it'll retry next
  // launch since the flag is only set on success.
  const deduped = await getSetting(DEDUPE_TOPICS_FLAG)
  if (!(deduped.success && deduped.data)) {
    const res = await dedupeTopics()
    if (res.success) await setSetting(DEDUPE_TOPICS_FLAG, '1')
  }

  // Self-heal any entries whose synthesis was interrupted (app killed before the
  // background index finished). Fire-and-forget — never block launch; no-ops
  // cheaply when there's nothing to re-index or the deep model isn't present.
  void catchUpUnindexed()

  // Best-effort emotion page scan at startup: a page may have become due while
  // the app was closed (the global trigger threshold is durable but the scan only
  // fires from a tickle, which only happens on a save). Also picks up pages whose
  // first aggregate was deferred until the deep model existed. Cheap no-op when
  // nothing's due. Fire-and-forget — never block launch.
  void maybeRefreshEmotionPages()
  void runStartupMaintenance()

  return ok(undefined)
}
