import path from 'path'

import type * as SecureStore from 'expo-secure-store'

const mockStore = new Map<string, string>()
const mockSecureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore.set(key, value) }),
}
const mockExpoCrypto = {
  getRandomBytesAsync: jest.fn(async (count: number) => new Uint8Array(count).fill(0xab)),
}

const demoRoot = path.resolve(__dirname, '../../demo')
const secureStorePath = require.resolve('expo-secure-store', { paths: [demoRoot] })
const expoCryptoPath = require.resolve('expo-crypto', { paths: [demoRoot] })
jest.doMock(secureStorePath, () => mockSecureStore)
jest.doMock(expoCryptoPath, () => mockExpoCrypto)

const { getDemoDatabaseKey } = require('../../demo/services/demo-key') as typeof import('../../demo/services/demo-key')

describe('demo SQLCipher key', () => {
  it('generates one device-only per-install key and reuses it after restart', async () => {
    const first = await getDemoDatabaseKey()
    const second = await getDemoDatabaseKey()

    expect(first).toBe('ab'.repeat(32))
    expect(second).toBe(first)
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'mindwiki.demo.database_key',
      first,
      { keychainAccessible: mockSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as SecureStore.SecureStoreOptions
    )
  })
})