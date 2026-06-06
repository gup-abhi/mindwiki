import argon2 from 'react-native-argon2'

import { CryptoModule } from '@/native/CryptoModule'

const mockArgon2 = argon2 as unknown as jest.Mock

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
  }
})

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(0xab)),
}))

describe('CryptoModule', () => {
  it('getKeyFromKeychain generates a 256-bit hex key and reuses it', async () => {
    const first = await CryptoModule.getKeyFromKeychain()
    expect(first).toHaveLength(64) // 32 bytes as hex
    const second = await CryptoModule.getKeyFromKeychain()
    expect(second).toBe(first) // persisted, not regenerated
  })

  it('derives a 32-byte (64-hex) key via Argon2id with the expected params', async () => {
    mockArgon2.mockClear()
    const key = await CryptoModule.deriveKey('pw', 'aabbccddeeff00112233445566778899')
    expect(key).toHaveLength(64)
    expect(mockArgon2).toHaveBeenCalledWith(
      'pw',
      'aabbccddeeff00112233445566778899',
      expect.objectContaining({ mode: 'argon2id', hashLength: 32, saltEncoding: 'hex' })
    )
  })

  it('still treats the AES paths as not-implemented (native pending)', async () => {
    await expect(CryptoModule.encrypt('x', 'k')).rejects.toThrow(/not implemented/)
    await expect(CryptoModule.decrypt('x', 'k')).rejects.toThrow(/not implemented/)
  })
})
