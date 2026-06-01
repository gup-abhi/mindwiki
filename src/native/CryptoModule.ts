import { notImplemented } from './notImplemented'

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
  /** AES-256-GCM encrypt. */
  encrypt(plaintext: string, keyHex: string): Promise<string>
  /** AES-256-GCM decrypt. */
  decrypt(ciphertext: string, keyHex: string): Promise<string>
}

export const CryptoModule: ICryptoModule = {
  async deriveKey() {
    return notImplemented('CryptoModule.deriveKey')
  },
  async getKeyFromKeychain() {
    return notImplemented('CryptoModule.getKeyFromKeychain')
  },
  async setKeyInKeychain() {
    return notImplemented('CryptoModule.setKeyInKeychain')
  },
  async encrypt() {
    return notImplemented('CryptoModule.encrypt')
  },
  async decrypt() {
    return notImplemented('CryptoModule.decrypt')
  },
}
