import type { Env } from '../types'
import {
  getAccountDeletionMarker,
  hashDeletionToken,
  setAccountDeletionMarker,
} from './deletion-marker'
import { deleteAccountMetadata, deleteRemoteStorage } from '../storage/delete'
import { coordinatorRequest } from './coordinator'

function releaseEmailReservation(env: Env, email: string | undefined, accountId: string): Promise<unknown> {
  return email
    ? coordinatorRequest(env.AUTH_COORDINATOR, `email:${email}`, {
        operation: 'release_email',
        account_id: accountId,
      })
    : Promise.resolve(null)
}


interface AccountRecord {
  email?: unknown
}

export async function handleAccountDeletionReadiness(
  env: Env,
  accountId: string
): Promise<Response> {
  try {
    await env.R2.list({ prefix: `${accountId}/`, limit: 1 })
    return new Response(null, { status: 204 })
  } catch {
    return new Response('Account deletion unavailable', { status: 503 })
  }
}

export async function handleDeleteAccount(
  req: Request,
  env: Env,
  accountId: string,
  familyId: string
): Promise<Response> {
  const existing = await getAccountDeletionMarker(env, accountId)
  if (existing?.status === 'complete') {
    await releaseEmailReservation(env, existing?.email, accountId)
    return new Response(null, { status: 204 })
  }

  const account = (await env.AUTH_KV.get(`account:${accountId}`, 'json')) as AccountRecord | null
  const email = typeof account?.email === 'string' ? account.email : existing?.email
  const bearer = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const tokenHash = existing?.token_hash ?? await hashDeletionToken(bearer)
  await setAccountDeletionMarker(env, {
    account_id: accountId,
    status: 'pending',
    ...(email ? { email } : {}),
    family_id: familyId,
    token_hash: tokenHash,
    updated_at: Date.now(),
  })

  try {
    await deleteRemoteStorage(env, accountId)
    await deleteAccountMetadata(env, accountId, email)
    await setAccountDeletionMarker(env, {
      account_id: accountId,
      status: 'complete',
      ...(email ? { email } : {}),
      family_id: familyId,
      token_hash: tokenHash,
      updated_at: Date.now(),
    })
    await releaseEmailReservation(env, email, accountId)
    return new Response(null, { status: 204 })
  } catch {
    return new Response('Account deletion incomplete; retry', { status: 503 })
  }
}
