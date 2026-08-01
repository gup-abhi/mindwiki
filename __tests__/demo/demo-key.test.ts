import * as SecureStore from 'expo-secure-store'

import { getDemoDatabaseKey } from '../../demo/services/demo-key'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { store.set(key, value) }),
  }
})
jest.mock('../../demo/node_modules/expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { store.set(key, value) }),
  }
})
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (count: number) => new Uint8Array(count).fill(0xab)),
}))
jest.mock('../../demo/node_modules/expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (count: number) => new Uint8Array(count).fill(0xab)),
}))

describe('demo SQLCipher key', () => {
  it('generates one device-only per-install key and reuses it after restart', async () => {
    const first = await getDemoDatabaseKey()
    const second = await getDemoDatabaseKey()

    expect(first).toBe('ab'.repeat(32))
    expect(second).toBe(first)
    const demoStore = jest.requireMock('../../demo/node_modules/expo-secure-store') as typeof SecureStore
    expect(demoStore.setItemAsync).toHaveBeenCalledWith(
      'mindwiki.demo.database_key',
      first,
      { keychainAccessible: demoStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    )
  })
})