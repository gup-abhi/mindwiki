import argon2 from 'react-native-argon2'

import { CryptoModule } from '@/native/CryptoModule'

const mockArgon2 = argon2 as unknown as jest.Mock

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k)
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

  it('returns a readable legacy key when best-effort hardening rewrite fails', async () => {
    const first = await CryptoModule.getKeyFromKeychain()
    const SecureStore = jest.requireMock('expo-secure-store') as { setItemAsync: jest.Mock; deleteItemAsync: jest.Mock }
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('keychain write failed'))

    await expect(CryptoModule.getKeyFromKeychain()).resolves.toBe(first)
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  })

  it('returns a readable legacy owner when best-effort hardening rewrite fails', async () => {
    await CryptoModule.setKeyOwner('account-1')
    const SecureStore = jest.requireMock('expo-secure-store') as { setItemAsync: jest.Mock; deleteItemAsync: jest.Mock }
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('keychain write failed'))

    await expect(CryptoModule.getKeyOwner()).resolves.toBe('account-1')
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
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
