import type { Env } from '../types'

export interface RateLimitDecision {
  allowed: boolean
  retryAfterSeconds?: number
}

const WINDOW_PREFIX = 'rl:'

/**
 * Sliding-window counter in KV. KV is eventually consistent, so a racing burst
 * can slip through (the window is reset per write); a Durable-Object limiter is
 * the production upgrade if that ever matters. Login brute-force is the vector
 * this guards: guessing the password unwraps the escrow → plaintext journal.
 */
export async function kvRateLimit(
  env: Env,
  scope: string,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitDecision> {
  const now = Date.now()
  const k = `${WINDOW_PREFIX}${scope}:${key}`
  const cur = (await env.AUTH_KV.get(k, 'json')) as { count: number; windowStart: number } | null
  if (!cur || now - cur.windowStart >= windowMs) {
    await env.AUTH_KV.put(k, JSON.stringify({ count: 1, windowStart: now }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    })
    return { allowed: true }
  }
  if (cur.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((cur.windowStart + windowMs - now) / 1000)),
    }
  }
  await env.AUTH_KV.put(k, JSON.stringify({ count: cur.count + 1, windowStart: cur.windowStart }), {
    expirationTtl: Math.ceil(windowMs / 1000),
  })
  return { allowed: true }
}

/** Origin IP via Cloudflare's connecting header; null under local dev. */
export function clientIp(req: Request): string | null {
  return req.headers.get('CF-Connecting-IP')
}