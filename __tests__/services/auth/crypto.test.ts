import { hashPassword, wrapMasterKey, unwrapMasterKey } from '@/services/auth/crypto'

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => new Uint8Array(n).fill(3),
}))

const WRAP_KEY = 'b'.repeat(64) // 32-byte Argon2-derived wrapping key (hex)
const MASTER_KEY = 'f0'.repeat(32) // 32-byte master key (hex)

describe('auth/crypto', () => {
  it('hashes a password to the known SHA-256 hex', () => {
    // SHA-256("password")
    expect(hashPassword('password')).toBe(
      '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
    )
  })

  it('wrap → unwrap recovers the master key', async () => {
    const wrapped = await wrapMasterKey(MASTER_KEY, WRAP_KEY)
    expect(wrapped.success).toBe(true)
    if (!wrapped.success) return
    expect(wrapped.data).not.toContain(MASTER_KEY) // escrow blob hides the key
    const unwrapped = await unwrapMasterKey(wrapped.data, WRAP_KEY)
    expect(unwrapped).toEqual({ success: true, data: MASTER_KEY })
  })

  it('fails to unwrap with the wrong wrapping key (wrong password)', async () => {
    const wrapped = await wrapMasterKey(MASTER_KEY, WRAP_KEY)
    if (!wrapped.success) throw new Error('wrap failed')
    const bad = await unwrapMasterKey(wrapped.data, 'c'.repeat(64))
    expect(bad.success).toBe(false)
  })
})
