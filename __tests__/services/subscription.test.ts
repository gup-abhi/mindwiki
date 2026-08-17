import { authenticatedFetch } from '@/services/auth/api-client'
import { getTrialStatus } from '@/services/subscription'

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
})
