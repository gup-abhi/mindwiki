import type { Env } from '../types'
import { issueTokens, sha256 } from './tokens'
import { getAccountDeletionMarker } from './deletion-marker'

// Marker retention matches the refresh-token lifetime so a rotated token can be
// recognized as a replay for as long as the token itself would have been valid.
const REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60

export async function handleRefresh(req: Request, env: Env): Promise<Response> {
  const { refresh_token } = (await req.json()) as { refresh_token: string }

  const tokenHash = await sha256(refresh_token)
  const stored = (await env.AUTH_KV.get(`refresh:${tokenHash}`, 'json')) as {
    account_id: string
    family_id: string
    expires_at: number
    used?: boolean
  } | null

  if (!stored) return new Response('Invalid refresh token', { status: 401 })
  if (await getAccountDeletionMarker(env, stored.account_id)) {
    return new Response('Account unavailable', { status: 401 })
  }

  if (stored.used) {
    // A rotated token presented again = replay of a stolen/leaked session.
    // Kill the whole family so the attacker's refreshed session dies with it.
    await env.AUTH_KV.put(
      `family:${stored.family_id}`,
      JSON.stringify({ account_id: stored.account_id, invalidated: true })
    )
    return new Response('Refresh token reuse detected', { status: 401 })
  }

  if (stored.expires_at < Date.now()) {
    await env.AUTH_KV.delete(`refresh:${tokenHash}`)
    return new Response('Refresh token expired', { status: 401 })
  }

  const family = (await env.AUTH_KV.get(`family:${stored.family_id}`, 'json')) as {
    invalidated: boolean
  } | null
  if (family?.invalidated) return new Response('Session invalidated', { status: 401 })

  // Rotate: mark the used token (kept for replay detection), issue a new pair
  // in the same family. The client single-flights refreshes per token, so a
  // same-token concurrent retry does not happen on its own.
  await env.AUTH_KV.put(
    `refresh:${tokenHash}`,
    JSON.stringify({ account_id: stored.account_id, family_id: stored.family_id, used: true }),
    { expirationTtl: REFRESH_TTL_SECONDS }
  )
  const { accessToken, refreshToken } = await issueTokens(stored.account_id, env, stored.family_id)

  return Response.json({ access_token: accessToken, refresh_token: refreshToken })
}
