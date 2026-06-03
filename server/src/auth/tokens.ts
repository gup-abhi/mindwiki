import { sign } from '@tsndr/cloudflare-worker-jwt'

import type { Env } from '../types'

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Issue an access JWT (15 min) + an opaque refresh token (90 days, stored
 * hashed). Refresh tokens belong to a family so reuse can invalidate the chain.
 */
export async function issueTokens(
  accountId: string,
  env: Env,
  existingFamilyId?: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const familyId = existingFamilyId ?? crypto.randomUUID()

  const accessToken = await sign(
    { sub: accountId, exp: Math.floor(Date.now() / 1000) + 900, type: 'access' },
    env.JWT_SECRET
  )

  const refreshToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const tokenHash = await sha256(refreshToken)
  await env.AUTH_KV.put(
    `refresh:${tokenHash}`,
    JSON.stringify({
      account_id: accountId,
      family_id: familyId,
      expires_at: Date.now() + 90 * 24 * 60 * 60 * 1000,
    }),
    { expirationTtl: 90 * 24 * 60 * 60 }
  )

  if (!existingFamilyId) {
    await env.AUTH_KV.put(
      `family:${familyId}`,
      JSON.stringify({ account_id: accountId, invalidated: false })
    )
  }

  return { accessToken, refreshToken }
}
