import { authenticatedFetch } from '@/services/auth/api-client'
import { type Result, ok, err } from '@/types/result'

export interface TrialStatus {
  trialStartedAt: number
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
