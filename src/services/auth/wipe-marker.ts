import * as SecureStore from 'expo-secure-store'

import { CryptoModule } from '@/native/CryptoModule'
import { deleteDatabase } from '@/services/storage/db'

import { clearTokens } from './token-store'

// Durable marker set at the very start of a logout wipe and cleared once the
// wipe completes (R1/R2, docs/AUTH_DB_LIFECYCLE.md). If the app is killed mid
// wipe, this survives in the keystore and repairInterruptedWipe() finishes the
// job at the next auth boundary — so the device can never be left unauthenticated
// with the previous account's key + DB still installed (cases 7/8).
const WIPE_PENDING_ID = 'mindwiki.wipe_pending'

export async function setWipePending(): Promise<void> {
  await SecureStore.setItemAsync(WIPE_PENDING_ID, '1')
}

export async function clearWipePending(): Promise<void> {
  await SecureStore.deleteItemAsync(WIPE_PENDING_ID)
}

export async function isWipePending(): Promise<boolean> {
  return (await SecureStore.getItemAsync(WIPE_PENDING_ID)) === '1'
}

/**
 * Finish an interrupted logout wipe (R2). Idempotent and safe to run at every
 * auth boundary (launch hydrate, and before register/login/recover/pair). If no
 * wipe was pending it's a no-op; otherwise it re-runs the destructive steps and
 * clears the marker, leaving a clean unauthenticated device.
 */
export async function repairInterruptedWipe(): Promise<void> {
  if (!(await isWipePending())) return
  deleteDatabase()
  await CryptoModule.deleteKeyFromKeychain()
  await CryptoModule.deleteKeyOwner()
  await clearTokens()
  await clearWipePending()
}
