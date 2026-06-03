import { compare } from 'bcryptjs'

import type { Env } from '../types'
import { issueTokens } from './tokens'

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const { email, password_hash } = await req.json<{ email: string; password_hash: string }>()

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
  const { accessToken, refreshToken } = await issueTokens(emailRecord.account_id, env)

  return Response.json({
    account_id: emailRecord.account_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    key_escrow: escrow, // client re-derives the master key from this
  })
}
