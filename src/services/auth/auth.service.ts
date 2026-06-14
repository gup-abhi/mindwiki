import { getRandomBytesAsync } from 'expo-crypto'

import { CryptoModule } from '@/native/CryptoModule'
import { useAuthStore } from '@/store/auth.store'
import { type Result, ok, err } from '@/types/result'

import { authenticatedFetch } from './api-client'
import { API_URL } from './config'
import { hashPassword, wrapMasterKey, unwrapMasterKey } from './crypto'
import {
  generateRecoveryPhrase,
  recoveryKeyFromPhrase,
  recoveryHash,
  isValidRecoveryPhrase,
} from './recovery'
import { getTokens, saveTokens, clearTokens } from './token-store'

async function randomHex(bytes: number): Promise<string> {
  const arr = await getRandomBytesAsync(bytes)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface AuthResponse {
  account_id: string
  access_token: string
  refresh_token: string
  key_escrow?: { encrypted_key: string; salt: string }
  recovery_escrow?: { encrypted_key: string }
}

/**
 * Register an account. Escrows the device's CURRENT master key (so existing
 * local data stays decryptable) under TWO independent wrapping keys: an
 * Argon2id(password) key, and a key derived from a generated recovery phrase —
 * the only way back in if the password is forgotten (the server is
 * zero-knowledge and cannot reset it). The server only ever sees
 * SHA-256(password), SHA-256(phrase), and the two encrypted escrow blobs.
 * Returns the recovery phrase so the caller can show it once for the user to
 * save; it is never persisted on-device.
 */
export async function register(
  email: string,
  password: string
): Promise<Result<{ accountId: string; recoveryPhrase: string }>> {
  try {
    const masterKey = await CryptoModule.getKeyFromKeychain()
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
      }),
    })
    if (res.status === 409) {
      return err('EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.')
    }
    if (!res.ok) return err('REGISTER_FAILED', `Registration failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    await saveTokens({ accessToken: data.access_token, refreshToken: data.refresh_token, accountId: data.account_id })
    // Don't flip auth state yet: the caller shows the recovery phrase first, then
    // authenticates on acknowledgement (so the user can't skip past saving it).
    return ok({ accountId: data.account_id, recoveryPhrase })
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
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password_hash: hashPassword(password) }),
    })
    // 401 = the server rejected the email/password pair (unknown email or bad
    // password). Surface a friendly message; keep the status for other failures.
    if (res.status === 401) return err('LOGIN_INVALID_CREDENTIALS', 'Wrong email or password')
    if (!res.ok) return err('LOGIN_FAILED', `Login failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    if (!data.key_escrow) return err('LOGIN_FAILED', 'Missing key escrow')

    const wrappingKey = await CryptoModule.deriveKey(password, data.key_escrow.salt)
    const masterKey = await unwrapMasterKey(data.key_escrow.encrypted_key, wrappingKey)
    if (!masterKey.success) return err('LOGIN_DECRYPT_FAILED', 'Wrong password or corrupt escrow')

    await CryptoModule.setKeyInKeychain(masterKey.data)
    await saveTokens({ accessToken: data.access_token, refreshToken: data.refresh_token, accountId: data.account_id })
    useAuthStore.getState().setAuthenticated(data.account_id)
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

    const res = await fetch(`${API_URL}/auth/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, recovery_hash: recoveryHash(phrase) }),
    })
    if (!res.ok) return err('RECOVER_FAILED', `Recovery failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    if (!data.recovery_escrow) return err('RECOVER_FAILED', 'Missing recovery escrow')

    const masterKey = await unwrapMasterKey(data.recovery_escrow.encrypted_key, recoveryKeyFromPhrase(phrase))
    if (!masterKey.success) return err('RECOVER_DECRYPT_FAILED', 'Wrong phrase or corrupt escrow')

    await CryptoModule.setKeyInKeychain(masterKey.data)
    await saveTokens({ accessToken: data.access_token, refreshToken: data.refresh_token, accountId: data.account_id })
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
  const tokens = await getTokens()
  if (tokens) useAuthStore.getState().setAuthenticated(tokens.accountId)
  else useAuthStore.getState().setUnauthenticated()
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
export async function addRecoveryPhrase(): Promise<Result<{ recoveryPhrase: string }>> {
  try {
    const masterKey = await CryptoModule.getKeyFromKeychain()
    const recoveryPhrase = await generateRecoveryPhrase()
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
    return ok({ recoveryPhrase })
  } catch (e) {
    return err('ADD_RECOVERY_FAILED', 'Set recovery failed', e)
  }
}

/** Sign out: drop the session (re-login required); local master key + data stay. */
export async function logout(): Promise<void> {
  await clearTokens()
  useAuthStore.getState().setUnauthenticated()
}
