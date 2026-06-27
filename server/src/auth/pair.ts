import type { Env } from '../types'
import { issueTokens } from './tokens'
import { recordPairedDevice } from './devices'

const PAIR_TTL_SECONDS = 300 // 5 minutes — the QR is meant to be scanned in person, now

/**
 * Start device pairing (authenticated, device A). Mints a one-time, short-lived
 * code bound to the account. The client puts this code + the master key into a
 * QR; the master key never touches the server (zero-knowledge preserved).
 */
export async function handlePairStart(
  _req: Request,
  env: Env,
  accountId: string
): Promise<Response> {
  const code = crypto.randomUUID()
  await env.AUTH_KV.put(`pair:${code}`, JSON.stringify({ account_id: accountId }), {
    expirationTtl: PAIR_TTL_SECONDS,
  })
  return Response.json({ code, expires_in: PAIR_TTL_SECONDS })
}

/**
 * Redeem a pairing code (public, device B). Exchanges the one-time code for a
 * session. The code is deleted on use; it only mints a session, so a stolen code
 * can read ciphertext but cannot decrypt without the master key (carried in the QR).
 */
export async function handlePairRedeem(req: Request, env: Env): Promise<Response> {
  const { code, device_label, platform, device_id } = await req.json<{
    code: string
    device_label?: string
    platform?: string
    device_id?: string
  }>()

  const rec = (await env.AUTH_KV.get(`pair:${code}`, 'json')) as { account_id: string } | null
  if (!rec) return new Response('Invalid or expired pairing code', { status: 401 })
  await env.AUTH_KV.delete(`pair:${code}`) // one-time use

  const { accessToken, refreshToken, familyId } = await issueTokens(rec.account_id, env)

  // Log the new device (with its session family, so it can be signed out
  // remotely) so the owner can see (and notice) what paired.
  await recordPairedDevice(
    env,
    rec.account_id,
    device_label ?? 'New device',
    platform ?? 'unknown',
    device_id,
    familyId
  )
  return Response.json({
    account_id: rec.account_id,
    access_token: accessToken,
    refresh_token: refreshToken,
  })
}
