import { getRandomBytesAsync } from 'expo-crypto'

import { CryptoModule } from '@/native/CryptoModule'
import { useAuthStore } from '@/store/auth.store'
import { type Result, ok, err } from '@/types/result'

import { API_URL } from './config'
import { hashPassword, wrapMasterKey, unwrapMasterKey } from './crypto'
import { saveTokens, clearTokens } from './token-store'

async function randomHex(bytes: number): Promise<string> {
  const arr = await getRandomBytesAsync(bytes)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface AuthResponse {
  account_id: string
  access_token: string
  refresh_token: string
  key_escrow?: { encrypted_key: string; salt: string }
}

/**
 * Register an account. Escrows the device's CURRENT master key (so existing
 * local data stays decryptable), wrapped under an Argon2id(password) key. The
 * server only ever sees SHA-256(password) + the encrypted escrow blob.
 */
export async function register(password: string, email?: string): Promise<Result<{ accountId: string }>> {
  try {
    const masterKey = await CryptoModule.getKeyFromKeychain()
    const salt = await randomHex(16)
    const wrappingKey = await CryptoModule.deriveKey(password, salt)
    const wrapped = await wrapMasterKey(masterKey, wrappingKey)
    if (!wrapped.success) return wrapped

    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password_hash: hashPassword(password),
        key_escrow: { encrypted_key: wrapped.data, salt },
      }),
    })
    if (!res.ok) return err('REGISTER_FAILED', `Registration failed (${res.status})`)

    const data = (await res.json()) as AuthResponse
    await saveTokens({ accessToken: data.access_token, refreshToken: data.refresh_token, accountId: data.account_id })
    useAuthStore.getState().setAuthenticated(data.account_id)
    return ok({ accountId: data.account_id })
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

/** Sign out: drop the session and return to anonymous (local journaling stays). */
export async function logout(): Promise<void> {
  await clearTokens()
  useAuthStore.getState().setAnonymous()
}
