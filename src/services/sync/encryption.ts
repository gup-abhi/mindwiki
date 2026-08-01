import { gcm } from '@noble/ciphers/aes'
import { hmac } from '@noble/hashes/hmac'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { getRandomBytesAsync } from 'expo-crypto'

import { type SyncTable } from './conflict'
import { type Result, ok, err } from '@/types/result'

const NONCE_BYTES = 12
const KEY_BYTES = 32
const textEncoder = new TextEncoder()

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error('Invalid hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function syncContext(accountId: string, table: SyncTable, syncId: string): Uint8Array {
  return textEncoder.encode(`mindwiki-sync-v2\0${accountId}\0${table}\0${syncId}`)
}

/** Opaque deterministic identifier. Server never receives plaintext record IDs. */
export function createSyncId(
  masterKeyHex: string,
  accountId: string,
  table: SyncTable,
  recordId: string
): string {
  const message = textEncoder.encode(`mindwiki-sync-id-v2\0${accountId}\0${table}\0${recordId}`)
  return bytesToHex(hmac(sha256, hexToBytes(masterKeyHex), message))
}

/** V2 key bound to authenticated account, table, and opaque sync identifier. */
export function deriveRecordKey(
  masterKeyHex: string,
  accountId: string,
  table: SyncTable,
  syncId: string
): Uint8Array {
  return hkdf(sha256, hexToBytes(masterKeyHex), undefined, syncContext(accountId, table, syncId), KEY_BYTES)
}

function deriveLegacyRecordKey(masterKeyHex: string, recordId: string): Uint8Array {
  return hkdf(sha256, hexToBytes(masterKeyHex), undefined, textEncoder.encode(recordId), KEY_BYTES)
}

/** AES-256-GCM with protocol context authenticated as AAD. */
export async function encryptRecord(
  plaintext: string,
  syncId: string,
  masterKeyHex: string,
  accountId: string,
  table: SyncTable
): Promise<Result<string>> {
  try {
    const context = syncContext(accountId, table, syncId)
    const key = deriveRecordKey(masterKeyHex, accountId, table, syncId)
    const nonce = Uint8Array.from(await getRandomBytesAsync(NONCE_BYTES))
    const ct = gcm(key, nonce, context).encrypt(textEncoder.encode(plaintext))
    const blob = new Uint8Array(nonce.length + ct.length)
    blob.set(nonce)
    blob.set(ct, nonce.length)
    return ok(bytesToHex(blob))
  } catch (cause) {
    return err('ENCRYPT_FAILED', 'Failed to encrypt record', cause)
  }
}

/** Decrypt V2 ciphertext. Wrong account/table/sync-id fails authentication. */
export async function decryptRecord(
  blobHex: string,
  syncId: string,
  masterKeyHex: string,
  accountId: string,
  table: SyncTable
): Promise<Result<string>> {
  try {
    const blob = hexToBytes(blobHex)
    if (blob.length < NONCE_BYTES + 16) throw new Error('Invalid ciphertext')
    const nonce = blob.slice(0, NONCE_BYTES)
    const ct = blob.slice(NONCE_BYTES)
    const context = syncContext(accountId, table, syncId)
    const key = deriveRecordKey(masterKeyHex, accountId, table, syncId)
    const pt = gcm(key, nonce, context).decrypt(ct)
    return ok(new TextDecoder().decode(pt))
  } catch (cause) {
    return err('DECRYPT_FAILED', 'Failed to decrypt record', cause)
  }
}

/** Read-only compatibility for objects encrypted before protocol V2. */
export async function decryptLegacyRecord(
  blobHex: string,
  recordId: string,
  masterKeyHex: string
): Promise<Result<string>> {
  try {
    const blob = hexToBytes(blobHex)
    if (blob.length < NONCE_BYTES + 16) throw new Error('Invalid ciphertext')
    const nonce = blob.slice(0, NONCE_BYTES)
    const ct = blob.slice(NONCE_BYTES)
    const pt = gcm(deriveLegacyRecordKey(masterKeyHex, recordId), nonce).decrypt(ct)
    return ok(new TextDecoder().decode(pt))
  } catch (cause) {
    return err('DECRYPT_FAILED', 'Failed to decrypt legacy record', cause)
  }
}