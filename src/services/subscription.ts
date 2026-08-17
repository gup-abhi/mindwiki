import { authenticatedFetch } from '@/services/auth/api-client'
import { type Result, ok, err } from '@/types/result'

export interface TrialStatus {
  trialStartedAt: number
}

export type TrialState =
  | {
      kind: 'trial-active'
      trialStartedAt: number
      trialEndsAt: number
      remainingDays: number
    }
  | {
      kind: 'trial-expired'
      trialStartedAt: number
      trialEndsAt: number
      remainingDays: 0
    }
  | { kind: 'unavailable' }

const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export function getTrialState(trialStartedAt: number, now: number): TrialState {
  if (!Number.isFinite(trialStartedAt) || !Number.isFinite(now) || trialStartedAt > now) {
    return { kind: 'unavailable' }
  }
  const trialEndsAt = trialStartedAt + TRIAL_DURATION_MS
  if (now >= trialEndsAt) {
    return { kind: 'trial-expired', trialStartedAt, trialEndsAt, remainingDays: 0 }
  }
  return {
    kind: 'trial-active',
    trialStartedAt,
    trialEndsAt,
    remainingDays: Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)),
  }
}

interface SubscriptionStatusResponse {
  trial_started_at?: unknown
}

export async function getTrialStatus(): Promise<Result<TrialStatus>> {
  const response = await authenticatedFetch('/auth/subscription-status', { method: 'GET' })
  if (!response.success) return response
  if (!response.data.ok) return err('SUBSCRIPTION_STATUS_FAILED', `Subscription status failed (${response.data.status})`)

  try {
    const body = await response.data.json() as SubscriptionStatusResponse
    if (typeof body.trial_started_at !== 'number' || !Number.isFinite(body.trial_started_at)) {
      return err('SUBSCRIPTION_STATUS_FAILED', 'Subscription status is unavailable')
    }
    return ok({ trialStartedAt: body.trial_started_at })
  } catch (cause) {
    return err('SUBSCRIPTION_STATUS_FAILED', 'Subscription status is unavailable', cause)
  }
}
