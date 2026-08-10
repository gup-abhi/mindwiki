import { verify } from '@tsndr/cloudflare-worker-jwt'

import type { Env } from '../types'
import {
  getAccountDeletionMarker,
  hashDeletionToken,
} from '../auth/deletion-marker'

type AuthResult =
  | { ok: true; accountId: string; familyId: string; deleting: boolean }
  | { ok: false }

interface AccessPayload {
  sub?: string
  fam?: string
  type?: string
}

function accessPayload(token: string): AccessPayload | null {
  try {
    return JSON.parse(atob(token.split('.')[1])) as AccessPayload
  } catch {
    return null
  }
}

/** Verify access JWT, extract account + session family, and reject revoked families. */
export async function authMiddleware(req: Request, env: Env): Promise<AuthResult> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { ok: false }

  try {
    const payload = accessPayload(token)
    if (!payload?.sub || !payload.fam || payload.type !== 'access') return { ok: false }

    const deletion = await getAccountDeletionMarker(env, payload.sub)
    if (deletion) {
      const sameToken = deletion.token_hash === await hashDeletionToken(token)
      if (deletion.account_id !== payload.sub || deletion.family_id !== payload.fam || !sameToken) {
        return { ok: false }
      }
      return { ok: true, accountId: payload.sub, familyId: payload.fam, deleting: true }
    }

    const valid = await verify(token, env.JWT_SECRET)
    if (!valid) return { ok: false }
    const family = (await env.AUTH_KV.get(`family:${payload.fam}`, 'json')) as {
      account_id?: string
      invalidated?: boolean
    } | null
    if (!family || family.account_id !== payload.sub || family.invalidated) return { ok: false }

    return { ok: true, accountId: payload.sub, familyId: payload.fam, deleting: false }
  } catch {
    return { ok: false }
  }
}
