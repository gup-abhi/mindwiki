import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  recoveryKeyFromPhrase,
  recoveryHash,
} from '@/services/auth/recovery'

describe('auth/recovery', () => {
  it('generates a valid 12-word phrase', () => {
    const phrase = generateRecoveryPhrase()
    expect(phrase.split(' ')).toHaveLength(12)
    expect(isValidRecoveryPhrase(phrase)).toBe(true)
  })

  it('rejects an invalid phrase', () => {
    expect(isValidRecoveryPhrase('not a real recovery phrase at all nope')).toBe(false)
    expect(isValidRecoveryPhrase('')).toBe(false)
  })

  it('derives a 32-byte hex wrapping key, deterministically', () => {
    const phrase = generateRecoveryPhrase()
    const key = recoveryKeyFromPhrase(phrase)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(recoveryKeyFromPhrase(phrase)).toBe(key) // same phrase → same key
  })

  it('is insensitive to spacing and case', () => {
    const phrase = generateRecoveryPhrase()
    const messy = `  ${phrase.toUpperCase().replace(/ /g, '   ')}  `
    expect(recoveryKeyFromPhrase(messy)).toBe(recoveryKeyFromPhrase(phrase))
    expect(recoveryHash(messy)).toBe(recoveryHash(phrase))
  })

  it('different phrases yield different keys and hashes', () => {
    const a = generateRecoveryPhrase()
    let b = generateRecoveryPhrase()
    while (b === a) b = generateRecoveryPhrase()
    expect(recoveryKeyFromPhrase(a)).not.toBe(recoveryKeyFromPhrase(b))
    expect(recoveryHash(a)).not.toBe(recoveryHash(b))
  })

  it('hashes to 64-hex (SHA-256)', () => {
    expect(recoveryHash(generateRecoveryPhrase())).toMatch(/^[0-9a-f]{64}$/)
  })
})
