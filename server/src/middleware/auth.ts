import { verify } from '@tsndr/cloudflare-worker-jwt'

import type { Env } from '../types'

type AuthResult = { ok: true; accountId: string; familyId: string } | { ok: false }

/** Verify access JWT, extract account + session family, and reject revoked families. */
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
      type?: string
    }
    if (!payload.sub || !payload.fam || payload.type !== 'access' || (payload.exp ?? 0) < Date.now() / 1000) {
      return { ok: false }
    }

    const family = (await env.AUTH_KV.get(`family:${payload.fam}`, 'json')) as {
      account_id?: string
      invalidated?: boolean
    } | null
    if (!family || family.account_id !== payload.sub || family.invalidated) return { ok: false }

    return { ok: true, accountId: payload.sub, familyId: payload.fam }
  } catch {
    return { ok: false }
  }
}