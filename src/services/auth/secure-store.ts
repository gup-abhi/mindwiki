import * as SecureStore from 'expo-secure-store'

/** Secrets must remain on this device; account transfer uses pairing or recovery. */
export const SECRET_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}