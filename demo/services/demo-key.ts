import { getRandomBytesAsync } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

const DEMO_DATABASE_KEY = 'mindwiki.demo.database_key'
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Stable random SQLCipher key for this demo install. Never exported or logged. */
export async function getDemoDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEMO_DATABASE_KEY)
  if (existing) {
    try { await SecureStore.setItemAsync(DEMO_DATABASE_KEY, existing, KEY_OPTIONS) } catch { /* keep readable legacy key */ }
    return existing
  }
  const key = toHex(await getRandomBytesAsync(32))
  await SecureStore.setItemAsync(DEMO_DATABASE_KEY, key, KEY_OPTIONS)
  return key
}