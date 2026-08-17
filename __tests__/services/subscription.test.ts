import { authenticatedFetch } from '@/services/auth/api-client'
import { getTrialStatus, getTrialState } from '@/services/subscription'

const DAY_MS = 24 * 60 * 60 * 1000
const TRIAL_DAYS = 30

jest.mock('@/services/auth/api-client', () => ({ authenticatedFetch: jest.fn() }))
const mockFetch = authenticatedFetch as jest.Mock

describe('getTrialStatus', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the server-anchored trial timestamp', async () => {
    mockFetch.mockResolvedValue({
      success: true,
      data: { ok: true, json: async () => ({ trial_started_at: 123 }) },
    })

    await expect(getTrialStatus()).resolves.toEqual({
      success: true,
      data: { trialStartedAt: 123 },
    })
    expect(mockFetch).toHaveBeenCalledWith('/auth/subscription-status', { method: 'GET' })
  })

  it('rejects malformed status without inventing a trial date', async () => {
    mockFetch.mockResolvedValue({
      success: true,
      data: { ok: true, json: async () => ({ trial_started_at: 'today' }) },
    })

    const result = await getTrialStatus()
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('SUBSCRIPTION_STATUS_FAILED')
  })

  it('preserves transport failures from the authenticated boundary', async () => {
    mockFetch.mockResolvedValue({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'offline' },
    })

    await expect(getTrialStatus()).resolves.toEqual({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'offline' },
    })
  })

  it('reports an active trial from the server timestamp', () => {
    expect(getTrialState(1_000, 1_000 + 10 * DAY_MS)).toEqual({
      kind: 'trial-active',
      trialStartedAt: 1_000,
      trialEndsAt: 1_000 + TRIAL_DAYS * DAY_MS,
      remainingDays: 20,
    })
  })

  it('reports an expired trial without relying on a local start time', () => {
    expect(getTrialState(1_000, 1_000 + 31 * DAY_MS)).toEqual({
      kind: 'trial-expired',
      trialStartedAt: 1_000,
      trialEndsAt: 1_000 + TRIAL_DAYS * DAY_MS,
      remainingDays: 0,
    })
  })

  it('rejects a future server timestamp', () => {
    expect(getTrialState(2_000, 1_000)).toEqual({
      kind: 'unavailable',
    })
  })
})
