import type { Env } from '../types'

interface AccountRecord {
  created_at?: number
  trial_started_at?: number
}

export async function handleSubscriptionStatus(
  _req: Request,
  env: Env,
  accountId: string
): Promise<Response> {
  const account = await env.AUTH_KV.get(`account:${accountId}`, 'json') as AccountRecord | null
  const trialStartedAt = account?.trial_started_at ?? account?.created_at
  if (typeof trialStartedAt !== 'number' || !Number.isFinite(trialStartedAt)) {
    return new Response('Account unavailable', { status: 404 })
  }

  return Response.json({ trial_started_at: trialStartedAt })
}
