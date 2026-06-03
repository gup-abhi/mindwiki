import { hash } from 'bcryptjs'

import type { Env } from '../types'
import { issueTokens } from './tokens'

interface RegisterBody {
  email?: string
  password_hash: string // SHA-256(password) hex — computed client-side
  key_escrow: { encrypted_key: string; salt: string }
}

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  const body = await req.json<RegisterBody>()

  if (!body.password_hash || body.password_hash.length !== 64) {
    return new Response('Invalid password_hash', { status: 400 })
  }
  if (!body.key_escrow?.encrypted_key || !body.key_escrow?.salt) {
    return new Response('Missing key_escrow', { status: 400 })
  }

  if (body.email) {
    const existing = await env.AUTH_KV.get(`email:${body.email.toLowerCase()}`)
    if (existing) return new Response('Email already registered', { status: 409 })
  }

  const passwordBcrypt = await hash(body.password_hash, 12)
  const accountId = crypto.randomUUID()
  const now = Date.now()

  await env.AUTH_KV.put(
    `account:${accountId}`,
    JSON.stringify({ email: body.email ?? null, password_bcrypt: passwordBcrypt, created_at: now })
  )
  if (body.email) {
    await env.AUTH_KV.put(
      `email:${body.email.toLowerCase()}`,
      JSON.stringify({ account_id: accountId })
    )
  }
  await env.AUTH_KV.put(
    `escrow:${accountId}`,
    JSON.stringify({
      encrypted_key: body.key_escrow.encrypted_key,
      salt: body.key_escrow.salt,
      updated_at: now,
    })
  )

  const { accessToken, refreshToken } = await issueTokens(accountId, env)
  return Response.json({ account_id: accountId, access_token: accessToken, refresh_token: refreshToken })
}
