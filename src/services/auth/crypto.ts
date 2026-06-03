import { gcm } from '@noble/ciphers/aes'
import { sha256 } from '@noble/hashes/sha256'
import { getRandomBytesAsync } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

const NONCE_BYTES = 12

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * SHA-256(password) as hex — sent to the server, which bcrypts it. The server
 * never sees the raw password, so the Argon2 master-key derivation stays local
 * (ADR 010).
 */
export function hashPassword(password: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(password)))
}

/**
 * Wrap the master key with a password-derived wrapping key (Argon2id output)
 * for server escrow. AES-256-GCM; output is hex of nonce || ciphertext(+tag).
 * The server stores this blob but cannot open it without the user's password.
 */
export async function wrapMasterKey(
  masterKeyHex: string,
  wrappingKeyHex: string
): Promise<Result<string>> {
  try {
    const key = hexToBytes(wrappingKeyHex)
    const nonce = Uint8Array.from(await getRandomBytesAsync(NONCE_BYTES))
    const ct = gcm(key, nonce).encrypt(new TextEncoder().encode(masterKeyHex))
    const blob = new Uint8Array(nonce.length + ct.length)
    blob.set(nonce)
    blob.set(ct, nonce.length)
    return ok(bytesToHex(blob))
  } catch (e) {
    return err('KEY_WRAP_FAILED', 'Failed to wrap master key', e)
  }
}

/** Recover the master key from an escrow blob using the password-derived key. */
export async function unwrapMasterKey(
  blobHex: string,
  wrappingKeyHex: string
): Promise<Result<string>> {
  try {
    const blob = hexToBytes(blobHex)
    const nonce = blob.slice(0, NONCE_BYTES)
    const ct = blob.slice(NONCE_BYTES)
    const key = hexToBytes(wrappingKeyHex)
    const pt = gcm(key, nonce).decrypt(ct)
    return ok(new TextDecoder().decode(pt))
  } catch (e) {
    return err('KEY_UNWRAP_FAILED', 'Failed to unwrap master key (wrong password?)', e)
  }
}
