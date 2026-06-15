import { getRandomBytesAsync } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import argon2, { type Argon2Options } from 'react-native-argon2'

import { notImplemented } from './notImplemented'

const MASTER_KEY_ID = 'mindwiki.master_key'

// Argon2id params for password → 256-bit wrapping key. 64 MiB / 3 iterations is
// comfortably above OWASP's mobile minimum; saltEncoding 'hex' because our salt
// is a hex string. hashLength 32 → rawHash is 64 hex chars = the AES-256 key.
const ARGON2_OPTS: Argon2Options = {
  iterations: 3,
  memory: 65536,
  parallelism: 1,
  hashLength: 32,
  mode: 'argon2id',
  saltEncoding: 'hex',
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Crypto operations backed by native code. CRITICAL invariants (see CLAUDE.md):
 * - deriveKey runs Argon2id CLIENT-SIDE only; the derived master key is NEVER transmitted.
 * - The key lives in iOS Keychain / Android Keystore only — never AsyncStorage/SQLite.
 * - The key must NEVER be logged.
 *
 * Phase -1 validated Argon2id (react-native-argon2) and SQLCipher on device.
 * Native implementation (Argon2 + AES-256-GCM + Keychain) lands in a later phase.
 */
export interface ICryptoModule {
  /** Argon2id(password, salt) → 32-byte key as hex. Client-side only. */
  deriveKey(password: string, salt: string): Promise<string>
  /** Read the master key from the OS keystore. */
  getKeyFromKeychain(): Promise<string>
  /** Persist the master key to the OS keystore. */
  setKeyInKeychain(key: string): Promise<void>
  /** Remove the master key from the OS keystore (e.g. on logout). */
  deleteKeyFromKeychain(): Promise<void>
  /** AES-256-GCM encrypt. */
  encrypt(plaintext: string, keyHex: string): Promise<string>
  /** AES-256-GCM decrypt. */
  decrypt(ciphertext: string, keyHex: string): Promise<string>
}

export const CryptoModule: ICryptoModule = {
  // Argon2id(password, salt) → 32-byte wrapping key (hex). Runs client-side
  // only; the derived key never leaves the device. salt is the hex string from
  // the escrow (same value on register + login, so the key reproduces exactly).
  async deriveKey(password: string, salt: string) {
    const { rawHash } = await argon2(password, salt, ARGON2_OPTS)
    return rawHash
  },
  // Anonymous-user master key: a random 256-bit key generated once and stored in
  // the OS keystore (iOS Keychain / Android Keystore via expo-secure-store).
  // Never derived from a password here — the Argon2/password path (deriveKey) is
  // for the sync/auth flow in a later phase.
  async getKeyFromKeychain() {
    const existing = await SecureStore.getItemAsync(MASTER_KEY_ID)
    if (existing) return existing
    const key = toHex(await getRandomBytesAsync(32))
    await SecureStore.setItemAsync(MASTER_KEY_ID, key)
    return key
  },
  async setKeyInKeychain(key: string) {
    await SecureStore.setItemAsync(MASTER_KEY_ID, key)
  },
  async deleteKeyFromKeychain() {
    await SecureStore.deleteItemAsync(MASTER_KEY_ID)
  },
  async encrypt() {
    return notImplemented('CryptoModule.encrypt')
  },
  async decrypt() {
    return notImplemented('CryptoModule.decrypt')
  },
}
