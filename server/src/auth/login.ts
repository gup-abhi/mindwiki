import { compare } from 'bcryptjs'

import type { Env } from '../types'
import { parseLoginBody, readJsonBody } from '../validation/request'
import { issueTokens } from './tokens'
import { recordPairedDevice } from './devices'
import { getAccountDeletionMarker } from './deletion-marker'

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = parseLoginBody(await readJsonBody(req))
  if (!body) return new Response('Invalid request body', { status: 400 })
  const { email, password_hash, device_label, platform, device_id } = body


  const emailRecord = (await env.AUTH_KV.get(`email:${email.toLowerCase()}`, 'json')) as {
    account_id: string
  } | null
  if (!emailRecord) return new Response('Invalid credentials', { status: 401 })
  if (await getAccountDeletionMarker(env, emailRecord.account_id)) {
    return new Response('Account unavailable', { status: 401 })
  }

  const account = (await env.AUTH_KV.get(`account:${emailRecord.account_id}`, 'json')) as {
    password_bcrypt: string
  } | null
  if (!account) return new Response('Invalid credentials', { status: 401 })

  const valid = await compare(password_hash, account.password_bcrypt)
  if (!valid) return new Response('Invalid credentials', { status: 401 })

  const escrow = await env.AUTH_KV.get(`escrow:${emailRecord.account_id}`, 'json')
  const recovery = (await env.AUTH_KV.get(`recovery:${emailRecord.account_id}`, 'json')) as {
    status?: 'pending_ack' | 'active'
  } | null
  const status = recovery?.status ?? 'active'

  const { accessToken, refreshToken, familyId } = await issueTokens(emailRecord.account_id, env)

  // Log this device (with its session family, so it can be signed out remotely)
  // so it shows up in the owner's paired-devices list, the same way redeeming a
  // pairing code does.
  await recordPairedDevice(
    env,
    emailRecord.account_id,
    device_label ?? 'New device',
    platform ?? 'unknown',
    device_id,
    familyId
  )

  return Response.json({
    account_id: emailRecord.account_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    key_escrow: escrow, // client re-derives the master key from this
    status,
  })
}
