import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  recoveryKeyFromPhrase,
  recoveryHash,
} from '@/services/auth/recovery'

// expo-crypto is native; entropy must come from it (not WebCrypto). Use real
// randomness in the mock so distinct phrases differ.
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) =>
    Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)),
}))

describe('auth/recovery', () => {
  it('generates a valid 12-word phrase', async () => {
    const phrase = await generateRecoveryPhrase()
    expect(phrase.split(' ')).toHaveLength(12)
    expect(isValidRecoveryPhrase(phrase)).toBe(true)
  })

  it('rejects an invalid phrase', () => {
    expect(isValidRecoveryPhrase('not a real recovery phrase at all nope')).toBe(false)
    expect(isValidRecoveryPhrase('')).toBe(false)
  })

  it('derives a 32-byte hex wrapping key, deterministically', async () => {
    const phrase = await generateRecoveryPhrase()
    const key = recoveryKeyFromPhrase(phrase)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(recoveryKeyFromPhrase(phrase)).toBe(key) // same phrase → same key
  })

  it('is insensitive to spacing and case', async () => {
    const phrase = await generateRecoveryPhrase()
    const messy = `  ${phrase.toUpperCase().replace(/ /g, '   ')}  `
    expect(recoveryKeyFromPhrase(messy)).toBe(recoveryKeyFromPhrase(phrase))
    expect(recoveryHash(messy)).toBe(recoveryHash(phrase))
  })

  it('different phrases yield different keys and hashes', async () => {
    const a = await generateRecoveryPhrase()
    let b = await generateRecoveryPhrase()
    while (b === a) b = await generateRecoveryPhrase()
    expect(recoveryKeyFromPhrase(a)).not.toBe(recoveryKeyFromPhrase(b))
    expect(recoveryHash(a)).not.toBe(recoveryHash(b))
  })

  it('hashes to 64-hex (SHA-256)', async () => {
    expect(recoveryHash(await generateRecoveryPhrase())).toMatch(/^[0-9a-f]{64}$/)
  })
})
