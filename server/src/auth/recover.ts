import { compare } from 'bcryptjs'

import type { Env } from '../types'
import { parseRecoverBody, readJsonBody } from '../validation/request'
import { issueTokens } from './tokens'
import { recordPairedDevice } from './devices'
import { getAccountDeletionMarker } from './deletion-marker'

/**
 * Account recovery via the recovery phrase (used when the password is lost).
 * Verifies SHA-256(phrase) against the stored bcrypt and returns the
 * recovery escrow — the master key wrapped under the phrase, which only the
 * holder of the phrase can open. The server stays zero-knowledge.
 */
export async function handleRecover(req: Request, env: Env): Promise<Response> {
  const body = parseRecoverBody(await readJsonBody(req))
  if (!body) return new Response('Invalid request body', { status: 400 })
  const { email, recovery_hash, device_label, platform, device_id } = body

  const emailRecord = (await env.AUTH_KV.get(`email:${email.toLowerCase()}`, 'json')) as {
    account_id: string
  } | null
  if (!emailRecord) return new Response('Invalid credentials', { status: 401 })
  if (await getAccountDeletionMarker(env, emailRecord.account_id)) {
    return new Response('Account unavailable', { status: 401 })
  }

  const recovery = (await env.AUTH_KV.get(`recovery:${emailRecord.account_id}`, 'json')) as {
    recovery_bcrypt: string
    encrypted_key: string
    status?: 'pending_ack' | 'active'
  } | null
  if (!recovery) return new Response('Invalid credentials', { status: 401 })

  const valid = await compare(recovery_hash, recovery.recovery_bcrypt)
  if (!valid) return new Response('Invalid credentials', { status: 401 })

  const { accessToken, refreshToken, familyId } = await issueTokens(emailRecord.account_id, env)
  await recordPairedDevice(
    env,
    emailRecord.account_id,
    device_label ?? 'Recovered device',
    platform ?? 'unknown',
    device_id,
    familyId
  )
  return Response.json({
    account_id: emailRecord.account_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    recovery_escrow: { encrypted_key: recovery.encrypted_key },
    status: recovery.status ?? 'active',
  })
}
