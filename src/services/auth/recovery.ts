import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

const KEY_BYTES = 32
const RECOVERY_INFO = new TextEncoder().encode('mindwiki-recovery-v1')

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Collapse whitespace + lowercase so typed-in phrases match regardless of spacing/case. */
function normalize(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Generate a fresh 12-word BIP39 recovery phrase (128 bits of entropy). */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 128)
}

/** True if the phrase is a structurally valid BIP39 mnemonic (word list + checksum). */
export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(normalize(phrase), wordlist)
}

/**
 * Wrapping key derived from the recovery phrase — the second escrow path for the
 * master key (parallel to the Argon2id(password) key). The phrase carries 128
 * bits of entropy, so HKDF-SHA256 over its entropy is sufficient; no Argon2
 * stretching needed. Returns 32-byte hex. Throws on an invalid phrase.
 */
export function recoveryKeyFromPhrase(phrase: string): string {
  const entropy = mnemonicToEntropy(normalize(phrase), wordlist)
  return bytesToHex(hkdf(sha256, entropy, undefined, RECOVERY_INFO, KEY_BYTES))
}

/**
 * SHA-256(phrase) as hex — the recovery credential sent to the server, which
 * bcrypts it (parallel to hashPassword). The server never sees the raw phrase,
 * so the key derivation stays local.
 */
export function recoveryHash(phrase: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(normalize(phrase))))
}
