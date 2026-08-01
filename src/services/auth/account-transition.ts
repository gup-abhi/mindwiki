import * as SecureStore from 'expo-secure-store'

import { CryptoModule } from '@/native/CryptoModule'
import { beginWipe, deleteDatabase, endWipe } from '@/services/storage/db'
import { clearTokens, saveTokens, type AuthTokens } from './token-store'
import { SECRET_STORE_OPTIONS } from './secure-store'

const TRANSITION_KEY = 'mindwiki.account_transition'

export interface AccountTransition {
  accountId: string
  masterKey: string
  tokens: AuthTokens
}

function parse(value: string | null): AccountTransition | null {
  if (!value) return null
  try {
    const candidate = JSON.parse(value) as Partial<AccountTransition>
    if (
      typeof candidate.accountId !== 'string' ||
      typeof candidate.masterKey !== 'string' ||
      !candidate.tokens ||
      typeof candidate.tokens.accessToken !== 'string' ||
      typeof candidate.tokens.refreshToken !== 'string' ||
      typeof candidate.tokens.accountId !== 'string'
    ) return null
    return candidate as AccountTransition
  } catch {
    return null
  }
}

export async function setAccountTransition(transition: AccountTransition): Promise<void> {
  await SecureStore.setItemAsync(TRANSITION_KEY, JSON.stringify(transition), SECRET_STORE_OPTIONS)
}

export async function clearAccountTransition(): Promise<void> {
  await SecureStore.deleteItemAsync(TRANSITION_KEY)
}

export async function getAccountTransition(): Promise<AccountTransition | null> {
  const transition = parse(await SecureStore.getItemAsync(TRANSITION_KEY))
  if (transition) {
    await SecureStore.setItemAsync(TRANSITION_KEY, JSON.stringify(transition), SECRET_STORE_OPTIONS)
  }
  return transition
}

/** Finish accepted registration after a crash, never leaving mixed account state. */
export async function repairAccountTransition(): Promise<boolean> {
  const transition = await getAccountTransition()
  if (!transition) return false
  beginWipe()
  try {
    if (deleteDatabase() === false) return false
    await CryptoModule.deleteKeyFromKeychain()
    await CryptoModule.deleteKeyOwner()
    await clearTokens()
    await CryptoModule.setKeyInKeychain(transition.masterKey)
    await CryptoModule.setKeyOwner(transition.accountId)
    await saveTokens(transition.tokens)
    await clearAccountTransition()
    return true
  } finally {
    endWipe()
  }
}