import type { Env } from '../types'
import { issueTokens, sha256 } from './tokens'

export async function handleRefresh(req: Request, env: Env): Promise<Response> {
  const { refresh_token } = await req.json<{ refresh_token: string }>()

  const tokenHash = await sha256(refresh_token)
  const stored = (await env.AUTH_KV.get(`refresh:${tokenHash}`, 'json')) as {
    account_id: string
    family_id: string
    expires_at: number
  } | null

  if (!stored) return new Response('Invalid refresh token', { status: 401 })

  if (stored.expires_at < Date.now()) {
    await env.AUTH_KV.delete(`refresh:${tokenHash}`)
    return new Response('Refresh token expired', { status: 401 })
  }

  const family = (await env.AUTH_KV.get(`family:${stored.family_id}`, 'json')) as {
    invalidated: boolean
  } | null
  if (family?.invalidated) return new Response('Session invalidated', { status: 401 })

  // Rotate: invalidate the used token, issue a new pair in the same family.
  await env.AUTH_KV.delete(`refresh:${tokenHash}`)
  const { accessToken, refreshToken } = await issueTokens(stored.account_id, env, stored.family_id)

  return Response.json({ access_token: accessToken, refresh_token: refreshToken })
}
