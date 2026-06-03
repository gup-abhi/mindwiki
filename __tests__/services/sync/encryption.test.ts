import { encryptRecord, decryptRecord, deriveRecordKey } from '@/services/sync/encryption'

// Deterministic nonce so we can assert ciphertext properties.
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => new Uint8Array(n).fill(7),
}))

const KEY = 'a'.repeat(64) // 32-byte master key in hex

describe('sync/encryption', () => {
  it('round-trips plaintext', async () => {
    const enc = await encryptRecord('hello, wiki', 'rec-1', KEY)
    expect(enc.success).toBe(true)
    if (!enc.success) return
    const dec = await decryptRecord(enc.data, 'rec-1', KEY)
    expect(dec).toEqual({ success: true, data: 'hello, wiki' })
  })

  it('never emits the plaintext in the ciphertext', async () => {
    const enc = await encryptRecord('topsecret', 'rec-1', KEY)
    if (enc.success) expect(enc.data).not.toContain('topsecret')
  })

  it('derives a distinct key per record id', () => {
    const a = deriveRecordKey(KEY, 'rec-1')
    const b = deriveRecordKey(KEY, 'rec-2')
    expect(a).toHaveLength(32)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('fails to decrypt with the wrong record id (key mismatch)', async () => {
    const enc = await encryptRecord('hello', 'rec-1', KEY)
    if (!enc.success) throw new Error('encrypt failed')
    const dec = await decryptRecord(enc.data, 'rec-2', KEY)
    expect(dec.success).toBe(false)
  })

  it('fails to decrypt tampered ciphertext', async () => {
    const enc = await encryptRecord('hello', 'rec-1', KEY)
    if (!enc.success) throw new Error('encrypt failed')
    const flipped = enc.data.slice(0, -2) + (enc.data.endsWith('00') ? '01' : '00')
    const dec = await decryptRecord(flipped, 'rec-1', KEY)
    expect(dec.success).toBe(false)
  })
})
