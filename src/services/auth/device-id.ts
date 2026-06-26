import * as SecureStore from 'expo-secure-store'
import { randomUUID } from 'expo-crypto'

// Persisted in the keystore so it survives logout — it identifies the physical
// device, not the account (and is not a secret).
const DEVICE_ID_KEY = 'mindwiki.device_id'

/**
 * A stable, per-install identifier for THIS device. Sent on register/login/pair
 * so the server keys the paired-devices row by it (re-login refreshes the same
 * row instead of duplicating it), and on logout so the server can remove exactly
 * this device's row.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY)
  if (existing) return existing
  const id = randomUUID()
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id)
  return id
}
