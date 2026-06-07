import {
  parsePairingPayload,
  startPairing,
  redeemPairing,
} from '@/services/sync/pairing'
import { CryptoModule } from '@/native/CryptoModule'
import { saveTokens, getTokens } from '@/services/auth/token-store'
import { useAuthStore } from '@/store/auth.store'

jest.mock('@/native/CryptoModule', () => ({
  CryptoModule: { getKeyFromKeychain: jest.fn(), setKeyInKeychain: jest.fn() },
}))
jest.mock('@/services/auth/token-store', () => ({
  saveTokens: jest.fn(),
  getTokens: jest.fn(),
  clearTokens: jest.fn(),
}))

const mockGetKey = CryptoModule.getKeyFromKeychain as jest.Mock
const mockSetKey = CryptoModule.setKeyInKeychain as jest.Mock
const mockSave = saveTokens as jest.Mock
const mockGetTokens = getTokens as jest.Mock

const MASTER = 'ab'.repeat(32) // 64 hex
const resp = (status: number, body: unknown = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
})

beforeEach(() => {
  jest.clearAllMocks()
  useAuthStore.setState({ status: 'loading', accountId: null })
  global.fetch = jest.fn()
  mockGetKey.mockResolvedValue(MASTER)
})

describe('parsePairingPayload', () => {
  it('accepts a valid payload', () => {
    const raw = JSON.stringify({ v: 1, code: 'abc', key: MASTER })
    expect(parsePairingPayload(raw)).toEqual({ success: true, data: { v: 1, code: 'abc', key: MASTER } })
  })

  it('rejects junk / wrong shape / bad key', () => {
    expect(parsePairingPayload('not json').success).toBe(false)
    expect(parsePairingPayload(JSON.stringify({ v: 2, code: 'a', key: MASTER })).success).toBe(false)
    expect(parsePairingPayload(JSON.stringify({ v: 1, code: 'a', key: 'short' })).success).toBe(false)
  })
})

describe('startPairing', () => {
  it('bundles the server code with the local master key', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(200, { code: 'pair-code', expires_in: 300 }))

    const res = await startPairing()

    expect(res.success).toBe(true)
    if (!res.success) return
    const payload = JSON.parse(res.data)
    expect(payload).toEqual({ v: 1, code: 'pair-code', key: MASTER })
  })

  it('fails when the server rejects', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(401))
    const res = await startPairing()
    expect(res.success).toBe(false)
  })
})

describe('redeemPairing', () => {
  it('redeems the code, installs the key, and authenticates', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, { account_id: 'acc1', access_token: 'at', refresh_token: 'rt' })
    )
    const raw = JSON.stringify({ v: 1, code: 'pair-code', key: MASTER })

    const res = await redeemPairing(raw)

    expect(res).toEqual({ success: true, data: { accountId: 'acc1' } })
    expect(mockSetKey).toHaveBeenCalledWith(MASTER)
    expect(mockSave).toHaveBeenCalledWith({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toEqual({ code: 'pair-code' }) // master key NOT sent to the server
  })

  it('rejects an invalid QR without hitting the server', async () => {
    const res = await redeemPairing('garbage')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('PAIR_INVALID_QR')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fails and does not install the key when the code is rejected', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(401))
    const raw = JSON.stringify({ v: 1, code: 'bad', key: MASTER })
    const res = await redeemPairing(raw)
    expect(res.success).toBe(false)
    expect(mockSetKey).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).not.toBe('authenticated')
  })
})
