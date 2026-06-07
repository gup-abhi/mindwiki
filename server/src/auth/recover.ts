import { compare } from 'bcryptjs'

import type { Env } from '../types'
import { issueTokens } from './tokens'

/**
 * Account recovery via the recovery phrase (used when the password is lost).
 * Verifies SHA-256(phrase) against the stored bcrypt and returns the
 * recovery escrow — the master key wrapped under the phrase, which only the
 * holder of the phrase can open. The server stays zero-knowledge.
 */
export async function handleRecover(req: Request, env: Env): Promise<Response> {
  const { email, recovery_hash } = await req.json<{ email: string; recovery_hash: string }>()

  const emailRecord = (await env.AUTH_KV.get(`email:${email.toLowerCase()}`, 'json')) as {
    account_id: string
  } | null
  if (!emailRecord) return new Response('Invalid credentials', { status: 401 })

  const recovery = (await env.AUTH_KV.get(`recovery:${emailRecord.account_id}`, 'json')) as {
    recovery_bcrypt: string
    encrypted_key: string
  } | null
  if (!recovery) return new Response('Invalid credentials', { status: 401 })

  const valid = await compare(recovery_hash, recovery.recovery_bcrypt)
  if (!valid) return new Response('Invalid credentials', { status: 401 })

  const { accessToken, refreshToken } = await issueTokens(emailRecord.account_id, env)
  return Response.json({
    account_id: emailRecord.account_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    recovery_escrow: { encrypted_key: recovery.encrypted_key },
  })
}
