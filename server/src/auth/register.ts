import { hash } from 'bcryptjs'

import type { Env } from '../types'
import { issueTokens } from './tokens'
import { recordPairedDevice } from './devices'

interface RegisterBody {
  email?: string
  password_hash: string // SHA-256(password) hex — computed client-side
  key_escrow: { encrypted_key: string; salt: string }
  recovery_hash: string // SHA-256(recovery phrase) hex — computed client-side
  recovery_escrow: { encrypted_key: string }
  device_label?: string
  platform?: string
}

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  const body = await req.json<RegisterBody>()

  if (!body.password_hash || body.password_hash.length !== 64) {
    return new Response('Invalid password_hash', { status: 400 })
  }
  if (!body.key_escrow?.encrypted_key || !body.key_escrow?.salt) {
    return new Response('Missing key_escrow', { status: 400 })
  }
  if (!body.recovery_hash || body.recovery_hash.length !== 64) {
    return new Response('Invalid recovery_hash', { status: 400 })
  }
  if (!body.recovery_escrow?.encrypted_key) {
    return new Response('Missing recovery_escrow', { status: 400 })
  }
  // Email is mandatory: login + escrow recovery are keyed by email, so an
  // email-less account would be unrecoverable (a permanent lockout).
  const email = body.email?.trim().toLowerCase()
  if (!email) return new Response('Email required', { status: 400 })

  const existing = await env.AUTH_KV.get(`email:${email}`)
  if (existing) return new Response('Email already registered', { status: 409 })

  const passwordBcrypt = await hash(body.password_hash, 12)
  const recoveryBcrypt = await hash(body.recovery_hash, 12)
  const accountId = crypto.randomUUID()
  const now = Date.now()

  await env.AUTH_KV.put(
    `account:${accountId}`,
    JSON.stringify({ email, password_bcrypt: passwordBcrypt, created_at: now })
  )
  await env.AUTH_KV.put(`email:${email}`, JSON.stringify({ account_id: accountId }))
  await env.AUTH_KV.put(
    `escrow:${accountId}`,
    JSON.stringify({
      encrypted_key: body.key_escrow.encrypted_key,
      salt: body.key_escrow.salt,
      updated_at: now,
    })
  )
  // Second escrow path: master key wrapped under the recovery phrase, plus the
  // bcrypted recovery credential. Used by /auth/recover when the password is lost.
  await env.AUTH_KV.put(
    `recovery:${accountId}`,
    JSON.stringify({
      recovery_bcrypt: recoveryBcrypt,
      encrypted_key: body.recovery_escrow.encrypted_key,
      updated_at: now,
    })
  )

  // Log the registering device so the account owner sees it in their devices list.
  await recordPairedDevice(env, accountId, body.device_label ?? 'New device', body.platform ?? 'unknown')

  const { accessToken, refreshToken } = await issueTokens(accountId, env)
  return Response.json({ account_id: accountId, access_token: accessToken, refresh_token: refreshToken })
}
