import { compare } from 'bcryptjs'

import type { Env } from '../types'
import { issueTokens } from './tokens'
import { recordPairedDevice } from './devices'

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const { email, password_hash, device_label, platform, device_id } = await req.json<{
    email: string
    password_hash: string
    device_label?: string
    platform?: string
    device_id?: string
  }>()

  const emailRecord = (await env.AUTH_KV.get(`email:${email.toLowerCase()}`, 'json')) as {
    account_id: string
  } | null
  if (!emailRecord) return new Response('Invalid credentials', { status: 401 })

  const account = (await env.AUTH_KV.get(`account:${emailRecord.account_id}`, 'json')) as {
    password_bcrypt: string
  } | null
  if (!account) return new Response('Invalid credentials', { status: 401 })

  const valid = await compare(password_hash, account.password_bcrypt)
  if (!valid) return new Response('Invalid credentials', { status: 401 })

  const escrow = await env.AUTH_KV.get(`escrow:${emailRecord.account_id}`, 'json')

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
  })
}
