import type { Env } from '../types'

const COMPLETE_DELETION_TTL_SECONDS = 24 * 60 * 60

export interface AccountDeletionMarker {
  account_id: string
  status: 'pending' | 'complete'
  email?: string
  family_id: string
  token_hash: string
  updated_at: number
}

export async function getAccountDeletionMarker(
  env: Env,
  accountId: string
): Promise<AccountDeletionMarker | null> {
  return (await env.AUTH_KV.get(`deleting:${accountId}`, 'json')) as AccountDeletionMarker | null
}

export async function hashDeletionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function setAccountDeletionMarker(
  env: Env,
  marker: AccountDeletionMarker
): Promise<void> {
  const options = marker.status === 'complete'
    ? { expirationTtl: COMPLETE_DELETION_TTL_SECONDS }
    : undefined
  await env.AUTH_KV.put(`deleting:${marker.account_id}`, JSON.stringify(marker), options)
}
