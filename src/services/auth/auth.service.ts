import { getRandomBytesAsync } from 'expo-crypto'

import { CryptoModule } from '@/native/CryptoModule'
import { useAuthStore } from '@/store/auth.store'
import { type Result, ok, err } from '@/types/result'

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

    const recoveryPhrase = generateRecoveryPhrase()
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
    if (!res.ok) return err('REGISTER_FAILED', `Registration failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    await saveTokens({ accessToken: data.access_token, refreshToken: data.refresh_token, accountId: data.account_id })
    useAuthStore.getState().setAuthenticated(data.account_id)
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
 * synced data decrypts, and starts a session. The caller should then prompt for
 * a NEW password (changePassword) — the old one is gone. Mirrors loginNewDevice.
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
    useAuthStore.getState().setAuthenticated(data.account_id)
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

/** Sign out: drop the session (re-login required); local master key + data stay. */
export async function logout(): Promise<void> {
  await clearTokens()
  useAuthStore.getState().setUnauthenticated()
}
