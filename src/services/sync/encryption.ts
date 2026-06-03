import { gcm } from '@noble/ciphers/aes'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { getRandomBytesAsync } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

const NONCE_BYTES = 12
const KEY_BYTES = 32

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Per-record key via HKDF-SHA256 from the master key, bound to the record id
 * (info). Distinct keys per record limit the blast radius of any single key.
 */
export function deriveRecordKey(masterKeyHex: string, recordId: string): Uint8Array {
  const ikm = hexToBytes(masterKeyHex)
  const info = new TextEncoder().encode(recordId)
  return hkdf(sha256, ikm, undefined, info, KEY_BYTES)
}

/**
 * AES-256-GCM encrypt a record. Output is hex of nonce || ciphertext(+tag), so
 * it can be stored/transmitted as a plain string. A fresh random nonce is used
 * per call. The master key never leaves the device; only this ciphertext syncs.
 */
export async function encryptRecord(
  plaintext: string,
  recordId: string,
  masterKeyHex: string
): Promise<Result<string>> {
  try {
    const key = deriveRecordKey(masterKeyHex, recordId)
    const nonce = Uint8Array.from(await getRandomBytesAsync(NONCE_BYTES))
    const ct = gcm(key, nonce).encrypt(new TextEncoder().encode(plaintext))
    const blob = new Uint8Array(nonce.length + ct.length)
    blob.set(nonce)
    blob.set(ct, nonce.length)
    return ok(bytesToHex(blob))
  } catch (e) {
    return err('ENCRYPT_FAILED', 'Failed to encrypt record', e)
  }
}

/** AES-256-GCM decrypt a record produced by encryptRecord. Fails on tamper/wrong key. */
export async function decryptRecord(
  blobHex: string,
  recordId: string,
  masterKeyHex: string
): Promise<Result<string>> {
  try {
    const blob = hexToBytes(blobHex)
    const nonce = blob.slice(0, NONCE_BYTES)
    const ct = blob.slice(NONCE_BYTES)
    const key = deriveRecordKey(masterKeyHex, recordId)
    const pt = gcm(key, nonce).decrypt(ct)
    return ok(new TextDecoder().decode(pt))
  } catch (e) {
    return err('DECRYPT_FAILED', 'Failed to decrypt record', e)
  }
}
