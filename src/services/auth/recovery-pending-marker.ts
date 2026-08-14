import * as SecureStore from 'expo-secure-store'

import { SECRET_STORE_OPTIONS } from './secure-store'

const PENDING_KEY = 'mindwiki.recovery_pending'

export type RecoveryPendingPhase = 'needs_phrase' | 'showing_phrase'

export interface RecoveryPending {
  accountId: string
  phase: RecoveryPendingPhase
}

function parse(raw: string | null): RecoveryPending | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const keys = Object.keys(value)
    if (keys.length !== 2) return null
    const candidate = value as Partial<RecoveryPending>
    if (typeof candidate.accountId !== 'string' || !candidate.accountId) return null
    if (candidate.phase !== 'needs_phrase' && candidate.phase !== 'showing_phrase') return null
    return { accountId: candidate.accountId, phase: candidate.phase }
  } catch {
    return null
  }
}

export async function setRecoveryPending(pending: RecoveryPending): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending), SECRET_STORE_OPTIONS)
}

export async function getRecoveryPending(): Promise<RecoveryPending | null> {
  return parse(await SecureStore.getItemAsync(PENDING_KEY))
}

export async function clearRecoveryPending(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_KEY)
}
