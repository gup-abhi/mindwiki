import { Platform } from 'react-native'
import { getRandomBytesAsync } from 'expo-crypto'
import * as Device from 'expo-device'

import { CryptoModule } from '@/native/CryptoModule'
import { beginWipe, deleteDatabase, endWipe } from '@/services/storage/db'
import { runtimeStoreBridge } from '@/services/runtime/store-bridge'
import { type Result, ok, err } from '@/types/result'
import { cleanupNotifications } from '@/services/notifications/cleanup'
import { resumeNotificationReconciliation, suspendNotificationReconciliation, waitForNotificationReconciliation } from '@/services/notifications/orchestrator'

import { authenticatedFetch } from './api-client'
import { API_URL } from './config'
import { getDeviceId } from './device-id'
import { hashPassword, wrapMasterKey, unwrapMasterKey } from './crypto'
import {
  generateRecoveryPhrase,
  recoveryKeyFromPhrase,
  recoveryHash,
  isValidRecoveryPhrase,
} from './recovery'
import { resetSessionStores } from './session-reset'
import { invalidateSessionWork, resumeSessionWork, waitForSessionWork } from './session-work'
import { clearAccountTransition, repairAccountTransition, setAccountTransition } from './account-transition'
import { clearRecoveryPending, getRecoveryPending, setRecoveryPending } from './recovery-pending-marker'
import { getTokens, saveTokens, clearTokens } from './token-store'
import * as tokenStore from './token-store'
import {
  clearWipePending,
  repairInterruptedWipe,
  setWipePending,
} from './wipe-marker'
import {
  clearAccountDeletionState,
  getAccountDeletionState,
  markAccountDeletionComplete,
  setAccountDeletionPending,
} from './account-deletion-marker'

// Hard cap on the best-effort server logout call so a hung network never blocks
// the local wipe (R1 step 3). On timeout we proceed to wipe regardless.
const SERVER_LOGOUT_TIMEOUT_MS = 5_000
const SERVER_DELETE_READINESS_TIMEOUT_MS = 5_000
let logoutFlight: Promise<void> | null = null
let deleteAccountFlight: Promise<Result<true>> | null = null
let pendingRecoveryPhrase: string | null = null

export function getPendingRecoveryPhrase(): string | null {
  return pendingRecoveryPhrase
}

export async function preparePendingRecovery(): Promise<Result<{ recoveryPhrase: string }>> {
  const result = await addRecoveryPhrase()
  if (result.success) pendingRecoveryPhrase = result.data.recoveryPhrase
  return result
}

async function randomHex(bytes: number): Promise<string> {
  const arr = await getRandomBytesAsync(bytes)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A label for this device in the owner's paired-devices log. Prefer the hardware
 * model (e.g. "iPhone 15 Pro", "Pixel 7") over the user-editable device name, so
 * the list stays recognizable and stable.
 */
function deviceLabel(): string {
  return Device.modelName || Device.deviceName || `${Platform.OS} device`
}

interface AuthResponse {
  account_id: string
  access_token: string
  refresh_token: string
  key_escrow?: { encrypted_key: string; salt: string }
  recovery_escrow?: { encrypted_key: string }
  status?: 'pending_ack' | 'active'
}

/**
 * Register an account. Generates a FRESH master key for the new account and
 * escrows it under TWO independent wrapping keys: an Argon2id(password) key, and
 * a key derived from a generated recovery phrase — the only way back in if the
 * password is forgotten (the server is zero-knowledge and cannot reset it). The
 * server only ever sees SHA-256(password), SHA-256(phrase), and the two
 * encrypted escrow blobs. Returns the recovery phrase so the caller can show it
 * once for the user to save; it is never persisted on-device.
 *
 * Account isolation (R3): any master key already in the keystore belongs to a
 * previous account — at register time there is no legitimate local data — so we
 * wipe key + DB before generating the fresh key. This closes the inherited-key
 * hole where a kill mid-logout left the old key installed for reuse (cases 7/8).
 */
export async function register(
  email: string,
  password: string
): Promise<Result<{ accountId: string; recoveryPhrase: string; status: 'pending_ack' | 'active' }>> {
  try {
    // Repair only an interrupted explicit wipe. Do not destroy retained local
    // state before server registration accepts this new account.
    await repairInterruptedWipe()
    await repairAccountTransition()

    // Candidate key stays in memory until server accepts registration. A failed
    // 409/network attempt must preserve the current account's local residue.
    const masterKey = await randomHex(32)
    const salt = await randomHex(16)
    const wrappingKey = await CryptoModule.deriveKey(password, salt)
    const wrapped = await wrapMasterKey(masterKey, wrappingKey)
    if (!wrapped.success) return wrapped

    const recoveryPhrase = await generateRecoveryPhrase()
    const recoveryWrapped = await wrapMasterKey(masterKey, recoveryKeyFromPhrase(recoveryPhrase))
    if (!recoveryWrapped.success) return recoveryWrapped

    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password_hash: hashPassword(password),
        key_escrow: { encrypted_key: wrapped.data, salt },
        recovery_hash: recoveryHash(recoveryPhrase),
        recovery_escrow: { encrypted_key: recoveryWrapped.data },
        device_label: deviceLabel(),
        platform: Platform.OS,
        device_id: await getDeviceId(),
      }),
    })
    if (res.status === 409) {
      return err('EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.')
    }
    if (res.status === 429) {
      return err('REGISTER_RATE_LIMITED', 'Too many attempts. Try again in a few minutes.')
    }
    if (!res.ok) return err('REGISTER_FAILED', `Registration failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    // Accepted registration is account transition point: now wipe old local
    // state, install candidate key, then persist ownership and session.
    await setAccountTransition({
      accountId: data.account_id,
      masterKey,
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accountId: data.account_id,
        status: data.status ?? 'pending_ack',
      },
    })
    await setRecoveryPending({ accountId: data.account_id, phase: 'needs_phrase' })
    await setWipePending()
    beginWipe()
    try {
      if (deleteDatabase() === false) throw new Error('Database deletion failed')
      await CryptoModule.deleteKeyFromKeychain()
      await CryptoModule.deleteKeyOwner()
      await CryptoModule.setKeyInKeychain(masterKey)
      await CryptoModule.setKeyOwner(data.account_id)
      await saveTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accountId: data.account_id,
        status: data.status ?? 'pending_ack',
      })
      await clearWipePending()
      await clearAccountTransition()
    } finally {
      endWipe()
    }
    // Don't flip auth state yet: the caller shows the recovery phrase first, then
    // authenticates on acknowledgement (so the user can't skip past saving it).
    return ok({ accountId: data.account_id, recoveryPhrase, status: data.status ?? 'pending_ack' })
  } catch (e) {
    return err('REGISTER_FAILED', 'Registration failed', e)
  }
}

/**
 * Sign in on a new device: recover the account master key from escrow using the
 * password, install it in the keystore so synced data decrypts, and store the
 * session. NOTE (device): the local DB must be re-keyed/reset to this master
 * key before sync — handled at the integration/sync step.
 */
export async function loginNewDevice(email: string, password: string): Promise<Result<{ accountId: string }>> {
  try {
    await repairInterruptedWipe()
    await repairAccountTransition()
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password_hash: hashPassword(password),
        device_label: deviceLabel(),
        platform: Platform.OS,
        device_id: await getDeviceId(),
      }),
    })
    // 401 = the server rejected the email/password pair (unknown email or bad
    // password). Surface a friendly message; keep the status for other failures.
    if (res.status === 401) return err('LOGIN_INVALID_CREDENTIALS', 'Wrong email or password')
    if (res.status === 429) {
      return err('LOGIN_RATE_LIMITED', 'Too many attempts. Try again in a few minutes.')
    }
    if (!res.ok) return err('LOGIN_FAILED', `Login failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    if (!data.key_escrow) return err('LOGIN_FAILED', 'Missing key escrow')

    const wrappingKey = await CryptoModule.deriveKey(password, data.key_escrow.salt)
    const masterKey = await unwrapMasterKey(data.key_escrow.encrypted_key, wrappingKey)
    if (!masterKey.success) return err('LOGIN_DECRYPT_FAILED', 'Wrong password or corrupt escrow')

    await CryptoModule.setKeyInKeychain(masterKey.data)
    await CryptoModule.setKeyOwner(data.account_id) // R3: this key belongs to this account
    await saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accountId: data.account_id,
      ...(data.status ? { status: data.status } : {}),
    })
    if (data.status === 'pending_ack') {
      await setRecoveryPending({ accountId: data.account_id, phase: 'needs_phrase' })
      runtimeStoreBridge().setRecoveryPending(data.account_id)
      return ok({ accountId: data.account_id })
    }

    // Signing in on a new device: the encrypted DB is empty until the first pull.
    // Flag a restore so the UI reassures the user their data is on its way.
    runtimeStoreBridge().beginSyncRestore()
    runtimeStoreBridge().setAuthenticated(data.account_id)
    return ok({ accountId: data.account_id })
  } catch (e) {
    return err('LOGIN_FAILED', 'Login failed', e)
  }
}

/**
 * Recover an account with the recovery phrase when the password is lost. Unwraps
 * the recovery escrow with the phrase-derived key, installs the master key so
 * synced data decrypts, and stores the session — but does NOT flip auth state:
 * recovery is a two-step wizard (recover → set a new password), so the caller
 * authenticates only after changePassword succeeds.
 */
export async function recoverAccount(
  email: string,
  phrase: string
): Promise<Result<{ accountId: string }>> {
  try {
    if (!isValidRecoveryPhrase(phrase)) return err('RECOVER_INVALID_PHRASE', 'Invalid recovery phrase')
    await repairInterruptedWipe()
    await repairAccountTransition()

    const res = await fetch(`${API_URL}/auth/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        recovery_hash: recoveryHash(phrase),
        device_label: deviceLabel(),
        platform: Platform.OS,
        device_id: await getDeviceId(),
      }),
    })
    if (res.status === 429) {
      return err('RECOVER_RATE_LIMITED', 'Too many attempts. Try again in a few minutes.')
    }
    if (!res.ok) return err('RECOVER_FAILED', `Recovery failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    if (!data.recovery_escrow) return err('RECOVER_FAILED', 'Missing recovery escrow')

    const masterKey = await unwrapMasterKey(data.recovery_escrow.encrypted_key, recoveryKeyFromPhrase(phrase))
    if (!masterKey.success) return err('RECOVER_DECRYPT_FAILED', 'Wrong phrase or corrupt escrow')

    await CryptoModule.setKeyInKeychain(masterKey.data)
    await CryptoModule.setKeyOwner(data.account_id) // R3: this key belongs to this account
    await saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accountId: data.account_id,
      status: data.status ?? 'active',
    })
    return ok({ accountId: data.account_id })
  } catch (e) {
    return err('RECOVER_FAILED', 'Recovery failed', e)
  }
}

/**
 * Resolve the launch auth state from stored tokens: authenticated when a session
 * exists (offline-first — journaling resumes without a network round-trip),
 * otherwise unauthenticated. Called once after storage init, off the 'loading'
 * state the store starts in.
 */
export async function hydrateAuth(): Promise<void> {
  // Finish an interrupted logout wipe before reading the session (R2), so a kill
  // mid-wipe can't relaunch into a half-torn-down authenticated state.
  await repairInterruptedWipe()
  const deletionState = await getAccountDeletionState()
  if (deletionState) {
    runtimeStoreBridge().setDeleting(deletionState.accountId)
    if (deletionState.remoteComplete) await finishDeletedAccountWipe()
    // A pending remote deletion requires an explicit retry. Auto-retrying here
    // would remove the user's chance to cancel a stale, local-only marker.
    return
  }
  await repairAccountTransition()
  const tokens = await getTokens()
  const pending = await getRecoveryPending()
  if (!tokens) {
    if (pending) await clearRecoveryPending()
    runtimeStoreBridge().setUnauthenticated()
    return
  }
  if (pending && pending.accountId !== tokens.accountId) {
    await clearTokens()
    await CryptoModule.deleteKeyFromKeychain()
    await CryptoModule.deleteKeyOwner()
    await clearRecoveryPending()
    runtimeStoreBridge().setUnauthenticated()
    return
  }
  if ((pending && pending.accountId === tokens.accountId) || tokens.status === 'pending_ack') {
    runtimeStoreBridge().setRecoveryPending(tokens.accountId)
    return
  }
  runtimeStoreBridge().setAuthenticated(tokens.accountId)
}


/**
 * Change the account password. Re-wraps the password escrow under a key derived
 * from the new password and updates the server; the master key is unchanged, so
 * the local DB is never re-keyed. Requires an active session (authenticatedFetch).
 * Used right after recoverAccount to set a fresh password.
 */
export async function changePassword(newPassword: string): Promise<Result<true>> {
  try {
    const masterKey = await CryptoModule.getKeyFromKeychain()
    const salt = await randomHex(16)
    const wrappingKey = await CryptoModule.deriveKey(newPassword, salt)
    const wrapped = await wrapMasterKey(masterKey, wrappingKey)
    if (!wrapped.success) return wrapped

    const res = await authenticatedFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        password_hash: hashPassword(newPassword),
        key_escrow: { encrypted_key: wrapped.data, salt },
      }),
    })
    if (!res.success) return res
    if (!res.data.ok) return err('CHANGE_PASSWORD_FAILED', `Change password failed (${res.data.status})`)
    return ok(true)
  } catch (e) {
    return err('CHANGE_PASSWORD_FAILED', 'Change password failed', e)
  }
}

/**
 * Whether the current account already has a recovery phrase configured. Used to
 * nudge accounts created before recovery existed. Best-effort (needs a session).
 */
export async function getRecoveryStatus(): Promise<Result<boolean>> {
  try {
    const res = await authenticatedFetch('/auth/recovery', { method: 'GET' })
    if (!res.success) return res
    if (!res.data.ok) return err('RECOVERY_STATUS_FAILED', `Recovery status failed (${res.data.status})`)
    const data = (await res.data.json()) as { configured: boolean }
    return ok(data.configured === true)
  } catch (e) {
    return err('RECOVERY_STATUS_FAILED', 'Recovery status failed', e)
  }
}

/**
 * Set up (or rotate) the recovery phrase for the current logged-in account:
 * wraps the device's master key under a freshly generated phrase and uploads the
 * escrow + credential. Returns the phrase for one-time display. Works only while
 * authenticated (the key comes from this device's keychain).
 */
export async function addRecoveryPhrase(
  phrase?: string
): Promise<Result<{ recoveryPhrase: string }>> {
  try {
    const masterKey = await CryptoModule.getKeyFromKeychain()
    const recoveryPhrase = phrase ?? await generateRecoveryPhrase()
    if (!isValidRecoveryPhrase(recoveryPhrase)) return err('ADD_RECOVERY_FAILED', 'Invalid recovery phrase')
    const wrapped = await wrapMasterKey(masterKey, recoveryKeyFromPhrase(recoveryPhrase))
    if (!wrapped.success) return wrapped

    const res = await authenticatedFetch('/auth/recovery', {
      method: 'POST',
      body: JSON.stringify({
        recovery_hash: recoveryHash(recoveryPhrase),
        recovery_escrow: { encrypted_key: wrapped.data },
      }),
    })
    if (!res.success) return res
    if (!res.data.ok) return err('ADD_RECOVERY_FAILED', `Set recovery failed (${res.data.status})`)
    const tokens = await getTokens()
    if (tokens) await saveTokens({ ...tokens, status: 'active' })
    return ok({ recoveryPhrase })
  } catch (e) {
    return err('ADD_RECOVERY_FAILED', 'Set recovery failed', e)
  }
}

/**
 * Sign out: drop the session AND wipe local state — delete the encrypted DB and
 * remove the master key from the keystore. Required for account isolation:
 * without it the next account on this device would inherit the previous
 * account's key and DB (privacy-first — no residual journal after logout).
 * Re-login re-pulls from the server.
 *
 * Ordering is load-bearing (R1, docs/AUTH_DB_LIFECYCLE.md). A durable
 * `wipe_pending` marker is set first, and the DB + key die BEFORE tokens are
 * cleared, so a kill at any point either leaves the user logged in (retryable)
 * or leaves the marker set for repairInterruptedWipe() to finish — never an
 * unauthenticated device with the old key + DB still installed (cases 7/8).
 */
export async function logout(): Promise<void> {
  if (logoutFlight) return logoutFlight
  tokenStore.invalidateTokenMutations?.()
  logoutFlight = logoutImpl().finally(() => {
    logoutFlight = null
  })
  return logoutFlight
}

export async function deleteAccount(): Promise<Result<true>> {
  if (deleteAccountFlight) return deleteAccountFlight
  deleteAccountFlight = deleteAccountImpl().finally(() => {
    deleteAccountFlight = null
  })
  return deleteAccountFlight
}

export async function canReturnToAccountFromDeletion(): Promise<Result<boolean>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SERVER_DELETE_READINESS_TIMEOUT_MS)
  try {
    const readiness = await authenticatedFetch('/auth/account/deletion-readiness', {
      method: 'GET',
      signal: controller.signal,
    })
    if (!readiness.success) {
      return err(
        'ACCOUNT_DELETE_STATUS_UNAVAILABLE',
        'Could not confirm whether deletion started. Check your connection and try again.',
        readiness.error
      )
    }
    if (readiness.data.status === 409) return ok(false)
    // A Worker version without account-deletion routes returns 404. It cannot
    // have accepted this deletion, so the durable marker exists only locally.
    if (readiness.data.status === 204 || readiness.data.status === 404) return ok(true)
    return err(
      'ACCOUNT_DELETE_STATUS_UNAVAILABLE',
      'Could not confirm whether deletion started. Try again after the server is updated.'
    )
  } catch (e) {
    return err(
      'ACCOUNT_DELETE_STATUS_UNAVAILABLE',
      'Could not confirm whether deletion started. Check your connection and try again.',
      e
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function returnToAccountFromDeletion(): Promise<Result<true>> {
  const deletionState = await getAccountDeletionState()
  const accountId = deletionState?.accountId ?? runtimeStoreBridge().getAccountId()
  if (!accountId) return err('NOT_AUTHENTICATED', 'No account to restore')

  const canReturn = await canReturnToAccountFromDeletion()
  if (!canReturn.success) return canReturn
  if (!canReturn.data) {
    return err(
      'ACCOUNT_DELETE_STARTED',
      'Remote deletion already started. Retry deletion to finish safely.'
    )
  }

  await clearAccountDeletionState()
  resumeNotificationReconciliation()
  resumeSessionWork()
  runtimeStoreBridge().setAuthenticated(accountId)
  return ok(true)
}

async function finishDeletedAccountWipe(): Promise<void> {
  await setWipePending()
  beginWipe()
  let completed = false
  try {
    if (deleteDatabase() === false) throw new Error('Database deletion failed')
    await CryptoModule.deleteKeyFromKeychain()
    await CryptoModule.deleteKeyOwner()
    await clearTokens()
    await clearRecoveryPending()
    await clearWipePending()
    await clearAccountDeletionState()
    completed = true
  } finally {
    endWipe()
    resetSessionStores()
    if (completed) runtimeStoreBridge().setUnauthenticated()
  }
}

async function deleteAccountImpl(): Promise<Result<true>> {
  let deletionLocked = false
  let deletionFinished = false
  let workQuiesced = false
  let resumeWork = true
  let accountId: string | null = runtimeStoreBridge().getAccountId()
  try {
    if (!accountId) return err('NOT_AUTHENTICATED', 'No active account')
    const deletionState = await getAccountDeletionState()
    if (!deletionState) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), SERVER_DELETE_READINESS_TIMEOUT_MS)
      try {
        const readiness = await authenticatedFetch('/auth/account/deletion-readiness', {
          method: 'GET',
          signal: controller.signal,
        })
        if (!readiness.success) {
          if (readiness.error.code === 'NOT_AUTHENTICATED' || readiness.error.code === 'SESSION_EXPIRED') {
            return readiness
          }
          return err(
            'ACCOUNT_DELETE_UNAVAILABLE',
            'Could not reach the server. Your account is unchanged — try again later.',
            readiness.error
          )
        }
        if (!readiness.data.ok) {
          return err(
            'ACCOUNT_DELETE_UNAVAILABLE',
            'Account deletion is unavailable. Your account is unchanged — try again later.'
          )
        }
      } finally {
        clearTimeout(timer)
      }
    }

    tokenStore.invalidateTokenMutations?.()
    suspendNotificationReconciliation()
    invalidateSessionWork()
    workQuiesced = true
    await waitForNotificationReconciliation()
    await waitForSessionWork(SERVER_LOGOUT_TIMEOUT_MS)
    try { await cleanupNotifications() } catch { /* best-effort; local wipe remains authoritative */ }

    if (!deletionState) await setAccountDeletionPending(accountId)
    deletionLocked = true
    runtimeStoreBridge().setDeleting(accountId)
    if (deletionState?.remoteComplete) {
      await finishDeletedAccountWipe()
      deletionFinished = true
      return ok(true)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SERVER_LOGOUT_TIMEOUT_MS)
    let remote: Result<Response>
    try {
      remote = await authenticatedFetch('/auth/account', { method: 'DELETE', signal: controller.signal })
    } catch (e) {
      return err('ACCOUNT_DELETE_FAILED', 'Account deletion failed', e)
    } finally {
      clearTimeout(timer)
    }
    if (!remote.success) {
      if (remote.error.code === 'NOT_AUTHENTICATED' || remote.error.code === 'SESSION_EXPIRED') {
        await clearAccountDeletionState()
        deletionLocked = false
      } else {
        resumeWork = false
      }
      return remote
    }
    if (!remote.data.ok) {
      resumeWork = false
      return err('ACCOUNT_DELETE_FAILED', `Account deletion failed (${remote.data.status})`)
    }

    await markAccountDeletionComplete(accountId)
    await finishDeletedAccountWipe()
    deletionFinished = true
    return ok(true)
  } catch (e) {
    if (deletionLocked) resumeWork = false
    return err('ACCOUNT_DELETE_FAILED', 'Account deletion failed', e)
  } finally {
    if (deletionLocked && !deletionFinished && accountId) {
      runtimeStoreBridge().setDeleting(accountId)
    }
    if (workQuiesced && resumeWork && !deletionFinished) {
      resumeNotificationReconciliation()
      resumeSessionWork()
    }
  }
}

async function logoutImpl(): Promise<void> {
  // 1. Durable marker: survives a kill so the wipe is always completable.
  await setWipePending()
  // 2. Quiesce before native cleanup. Generation invalidation makes every
  //    in-flight reconciler checkpoint fail; a schedule resolving late cancels
  // its own identifier instead of writing into the wiped account.
  suspendNotificationReconciliation()
  invalidateSessionWork()
  beginWipe()

  try {
    await waitForNotificationReconciliation()
    await waitForSessionWork(SERVER_LOGOUT_TIMEOUT_MS)

    // 3. Native notification state is account-bound. Cleanup is best-effort and
    //    bounded — a hung native API must not delay the security-critical wipe.
    try { await cleanupNotifications() } catch { /* best-effort; continue local wipe */ }

    // 4. Best-effort server logout while tokens still exist. Abort the request
    //    on timeout so late completion cannot race local destruction.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SERVER_LOGOUT_TIMEOUT_MS)
    try {
      await authenticatedFetch('/auth/logout', { method: 'POST', signal: controller.signal })
    } catch {
      // ignore — local logout must always succeed
    } finally {
      clearTimeout(timer)
    }

    // 5–7. Destroy local state: DB, then key, then tokens (DB/key before tokens).
    if (deleteDatabase() === false) throw new Error('Database deletion failed')
    await CryptoModule.deleteKeyFromKeychain()
    await CryptoModule.deleteKeyOwner()
    await clearTokens()
    await clearRecoveryPending()
    await clearWipePending()
  } finally {
    // Marker intentionally survives a failed destructive step so launch repair
    // can finish the wipe. Guard/store reset must still happen on every path.
    endWipe()
    resetSessionStores()
    runtimeStoreBridge().setUnauthenticated()
  }
}
