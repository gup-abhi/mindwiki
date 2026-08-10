import * as SecureStore from 'expo-secure-store'

import { SECRET_STORE_OPTIONS } from './secure-store'

const ACCOUNT_DELETION_ID = 'mindwiki.account_deletion'

export interface AccountDeletionState {
  accountId: string
  remoteComplete: boolean
}

export async function getAccountDeletionState(): Promise<AccountDeletionState | null> {
  const value = await SecureStore.getItemAsync(ACCOUNT_DELETION_ID)
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { accountId?: unknown; remoteComplete?: unknown }
    if (typeof parsed.accountId !== 'string' || typeof parsed.remoteComplete !== 'boolean') return null
    return { accountId: parsed.accountId, remoteComplete: parsed.remoteComplete }
  } catch {
    return null
  }
}

async function setAccountDeletionState(state: AccountDeletionState): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_DELETION_ID, JSON.stringify(state), SECRET_STORE_OPTIONS)
}

export async function setAccountDeletionPending(accountId: string): Promise<void> {
  await setAccountDeletionState({ accountId, remoteComplete: false })
}

export async function markAccountDeletionComplete(accountId: string): Promise<void> {
  await setAccountDeletionState({ accountId, remoteComplete: true })
}

export async function clearAccountDeletionState(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCOUNT_DELETION_ID)
}
