import { verify } from '@tsndr/cloudflare-worker-jwt'

import type { Env } from '../types'

type AuthResult = { ok: true; accountId: string } | { ok: false }

/** Verify the Bearer access token and extract the account id (sub). */
export async function authMiddleware(req: Request, env: Env): Promise<AuthResult> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { ok: false }

  try {
    const valid = await verify(token, env.JWT_SECRET)
    if (!valid) return { ok: false }

    const payload = JSON.parse(atob(token.split('.')[1])) as {
      sub?: string
      exp?: number
      fam?: string
    }
    if (!payload.sub || (payload.exp ?? 0) < Date.now() / 1000) return { ok: false }

    // Reject a revoked session right away — don't wait for the short-lived access
    // token to expire. If the token names its session family and that family was
    // invalidated (e.g. the device was signed out from another device), deny.
    if (payload.fam) {
      const family = (await env.AUTH_KV.get(`family:${payload.fam}`, 'json')) as {
        invalidated?: boolean
      } | null
      if (family?.invalidated) return { ok: false }
    }

    return { ok: true, accountId: payload.sub }
  } catch {
    return { ok: false }
  }
}
