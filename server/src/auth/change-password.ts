import { hash } from 'bcryptjs'

import type { Env } from '../types'

interface ChangePasswordBody {
  password_hash: string // SHA-256(new password) hex — computed client-side
  key_escrow: { encrypted_key: string; salt: string }
}

/**
 * Change the account password. Re-wraps the password escrow (the master key is
 * unchanged, so synced data is unaffected — the DB is never re-keyed) and
 * updates the bcrypted credential. Authenticated route: accountId comes from the
 * access token. Used after recovery to set a fresh password.
 */
export async function handleChangePassword(
  req: Request,
  env: Env,
  accountId: string
): Promise<Response> {
  const body = await req.json<ChangePasswordBody>()

  if (!body.password_hash || body.password_hash.length !== 64) {
    return new Response('Invalid password_hash', { status: 400 })
  }
  if (!body.key_escrow?.encrypted_key || !body.key_escrow?.salt) {
    return new Response('Missing key_escrow', { status: 400 })
  }

  const account = (await env.AUTH_KV.get(`account:${accountId}`, 'json')) as {
    email: string
    password_bcrypt: string
    created_at: number
  } | null
  if (!account) return new Response('Account not found', { status: 404 })

  const passwordBcrypt = await hash(body.password_hash, 12)
  await env.AUTH_KV.put(
    `account:${accountId}`,
    JSON.stringify({ ...account, password_bcrypt: passwordBcrypt })
  )
  await env.AUTH_KV.put(
    `escrow:${accountId}`,
    JSON.stringify({
      encrypted_key: body.key_escrow.encrypted_key,
      salt: body.key_escrow.salt,
      updated_at: Date.now(),
    })
  )

  return new Response(null, { status: 204 })
}
