import {
  createSyncId,
  decryptLegacyRecord,
  decryptRecord,
  deriveRecordKey,
  encryptRecord,
} from '@/services/sync/encryption'

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => new Uint8Array(n).fill(7),
}))

const KEY = 'a'.repeat(64)
const ACCOUNT = 'account-1'
const TABLE = 'entries' as const

describe('sync/encryption', () => {
  it('round-trips V2 plaintext with context-bound encryption', async () => {
    const syncId = createSyncId(KEY, ACCOUNT, TABLE, 'rec-1')
    const enc = await encryptRecord('hello, wiki', syncId, KEY, ACCOUNT, TABLE)
    expect(enc.success).toBe(true)
    if (!enc.success) return
    const dec = await decryptRecord(enc.data, syncId, KEY, ACCOUNT, TABLE)
    expect(dec).toEqual({ success: true, data: 'hello, wiki' })
  })

  it('creates opaque, deterministic, domain-separated HMAC sync IDs', () => {
    const first = createSyncId(KEY, ACCOUNT, TABLE, 'private / label 日本語')
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toContain('private')
    expect(createSyncId(KEY, ACCOUNT, TABLE, 'private / label 日本語')).toBe(first)
    expect(createSyncId(KEY, ACCOUNT, 'wiki_pages', 'private / label 日本語')).not.toBe(first)
    expect(createSyncId(KEY, 'account-2', TABLE, 'private / label 日本語')).not.toBe(first)
  })

  it('derives distinct keys for account, table, and sync-id contexts', () => {
    const syncId = createSyncId(KEY, ACCOUNT, TABLE, 'rec-1')
    const first = deriveRecordKey(KEY, ACCOUNT, TABLE, syncId)
    expect(first).toHaveLength(32)
    expect(Buffer.from(first).equals(Buffer.from(deriveRecordKey(KEY, 'account-2', TABLE, syncId)))).toBe(false)
    expect(Buffer.from(first).equals(Buffer.from(deriveRecordKey(KEY, ACCOUNT, 'wiki_pages', syncId)))).toBe(false)
  })

  it('fails when account, table, sync id, or ciphertext changes', async () => {
    const syncId = createSyncId(KEY, ACCOUNT, TABLE, 'rec-1')
    const enc = await encryptRecord('hello', syncId, KEY, ACCOUNT, TABLE)
    if (!enc.success) throw new Error('encrypt failed')

    expect((await decryptRecord(enc.data, syncId, KEY, 'account-2', TABLE)).success).toBe(false)
    expect((await decryptRecord(enc.data, syncId, KEY, ACCOUNT, 'wiki_pages')).success).toBe(false)
    expect((await decryptRecord(enc.data, 'b'.repeat(64), KEY, ACCOUNT, TABLE)).success).toBe(false)
    const flipped = enc.data.slice(0, -2) + (enc.data.endsWith('00') ? '01' : '00')
    expect((await decryptRecord(flipped, syncId, KEY, ACCOUNT, TABLE)).success).toBe(false)
  })

  it('keeps explicit read-only legacy decryption compatibility', async () => {
    // Existing fixture from old API, generated deterministically by old implementation.
    const { gcm } = jest.requireActual('@noble/ciphers/aes') as typeof import('@noble/ciphers/aes')
    const { hkdf } = jest.requireActual('@noble/hashes/hkdf') as typeof import('@noble/hashes/hkdf')
    const { sha256 } = jest.requireActual('@noble/hashes/sha256') as typeof import('@noble/hashes/sha256')
    const key = hkdf(sha256, Uint8Array.from(Buffer.from(KEY, 'hex')), undefined, new TextEncoder().encode('legacy-id'), 32)
    const nonce = new Uint8Array(12).fill(7)
    const ciphertext = gcm(key, nonce).encrypt(new TextEncoder().encode('legacy'))
    const blob = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]).toString('hex')

    expect(await decryptLegacyRecord(blob, 'legacy-id', KEY)).toEqual({ success: true, data: 'legacy' })
  })
})