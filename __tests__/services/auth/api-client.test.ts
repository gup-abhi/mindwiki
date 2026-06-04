import { authenticatedFetch } from '@/services/auth/api-client'
import { getTokens, saveTokens, clearTokens } from '@/services/auth/token-store'
import { useAuthStore } from '@/store/auth.store'

jest.mock('@/services/auth/token-store', () => ({
  getTokens: jest.fn(),
  saveTokens: jest.fn(),
  clearTokens: jest.fn(),
}))

const mockGet = getTokens as jest.Mock
const mockSave = saveTokens as jest.Mock
const mockClear = clearTokens as jest.Mock

const resp = (status: number, body: unknown = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
})

const TOKENS = { accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' }

beforeEach(() => {
  jest.clearAllMocks()
  useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
  global.fetch = jest.fn()
})

describe('authenticatedFetch', () => {
  it('errors when there is no session', async () => {
    mockGet.mockResolvedValue(null)
    const res = await authenticatedFetch('/x')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('NOT_AUTHENTICATED')
  })

  it('attaches the bearer token and returns the response', async () => {
    mockGet.mockResolvedValue(TOKENS)
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(resp(200))
    const res = await authenticatedFetch('/sync/x')
    expect(res.success).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sync/x'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer at' }) })
    )
  })

  it('refreshes once on 401 and retries', async () => {
    mockGet
      .mockResolvedValueOnce(TOKENS) // initial
      .mockResolvedValueOnce(TOKENS) // inside refresh
      .mockResolvedValueOnce({ ...TOKENS, accessToken: 'at2' }) // after refresh
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(resp(401)) // first attempt
      .mockResolvedValueOnce(resp(200, { access_token: 'at2', refresh_token: 'rt2' })) // refresh
      .mockResolvedValueOnce(resp(200)) // retry
    const res = await authenticatedFetch('/sync/x')
    expect(res.success).toBe(true)
    expect(mockSave).toHaveBeenCalledTimes(1)
    // retry used the refreshed token
    expect((global.fetch as jest.Mock).mock.calls[2][1].headers.Authorization).toBe('Bearer at2')
  })

  it('clears the session and goes unauthenticated when refresh fails', async () => {
    mockGet.mockResolvedValue(TOKENS)
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(resp(401)) // first attempt
      .mockResolvedValueOnce(resp(401)) // refresh fails
    const res = await authenticatedFetch('/sync/x')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('SESSION_EXPIRED')
    expect(mockClear).toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })
})
