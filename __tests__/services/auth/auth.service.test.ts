import { register, loginNewDevice, hydrateAuth } from '@/services/auth/auth.service'
import { wrapMasterKey } from '@/services/auth/crypto'
import { saveTokens, getTokens } from '@/services/auth/token-store'
import { CryptoModule } from '@/native/CryptoModule'
import { useAuthStore } from '@/store/auth.store'

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => new Uint8Array(n).fill(5),
}))
jest.mock('@/native/CryptoModule', () => ({
  CryptoModule: {
    getKeyFromKeychain: jest.fn(),
    deriveKey: jest.fn(),
    setKeyInKeychain: jest.fn(),
  },
}))
jest.mock('@/services/auth/token-store', () => ({
  saveTokens: jest.fn(),
  clearTokens: jest.fn(),
  getTokens: jest.fn(),
}))

const mockGetKey = CryptoModule.getKeyFromKeychain as jest.Mock
const mockDerive = CryptoModule.deriveKey as jest.Mock
const mockSetKey = CryptoModule.setKeyInKeychain as jest.Mock
const mockSave = saveTokens as jest.Mock
const mockGetTokens = getTokens as jest.Mock

const MASTER = 'ab'.repeat(32)
const WRAP = 'cd'.repeat(32)
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
  mockDerive.mockResolvedValue(WRAP)
})

describe('register', () => {
  it('escrows the master key and authenticates on success', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, { account_id: 'acc1', access_token: 'at', refresh_token: 'rt' })
    )
    const res = await register('a@b.com', 'password')

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.accountId).toBe('acc1')
    expect(res.data.recoveryPhrase.split(' ')).toHaveLength(12) // shown once for the user to save
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.email).toBe('a@b.com')
    expect(body.password_hash).toBe('5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8')
    expect(body.key_escrow.encrypted_key).toBeTruthy()
    expect(body.key_escrow.salt).toBeTruthy()
    expect(body.recovery_hash).toMatch(/^[0-9a-f]{64}$/) // second escrow credential
    expect(body.recovery_escrow.encrypted_key).toBeTruthy()
    expect(mockSave).toHaveBeenCalledWith({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('fails on a server error', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(resp(409))
    const res = await register('a@b.com', 'password')
    expect(res.success).toBe(false)
  })
})

describe('loginNewDevice', () => {
  it('recovers the master key from escrow and installs it', async () => {
    const escrow = await wrapMasterKey(MASTER, WRAP)
    if (!escrow.success) throw new Error('setup wrap failed')
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, {
        account_id: 'acc1',
        access_token: 'at',
        refresh_token: 'rt',
        key_escrow: { encrypted_key: escrow.data, salt: '00' },
      })
    )

    const res = await loginNewDevice('a@b.com', 'password')

    expect(res).toEqual({ success: true, data: { accountId: 'acc1' } })
    expect(mockDerive).toHaveBeenCalledWith('password', '00')
    expect(mockSetKey).toHaveBeenCalledWith(MASTER) // account key installed
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('fails with the wrong password (escrow cannot be unwrapped)', async () => {
    const escrow = await wrapMasterKey(MASTER, WRAP)
    if (!escrow.success) throw new Error('setup wrap failed')
    mockDerive.mockResolvedValueOnce('ee'.repeat(32)) // wrong wrapping key
    ;(global.fetch as jest.Mock).mockResolvedValue(
      resp(200, {
        account_id: 'acc1',
        access_token: 'at',
        refresh_token: 'rt',
        key_escrow: { encrypted_key: escrow.data, salt: '00' },
      })
    )

    const res = await loginNewDevice('a@b.com', 'wrong')
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('LOGIN_DECRYPT_FAILED')
    expect(mockSetKey).not.toHaveBeenCalled()
  })
})

describe('hydrateAuth', () => {
  it('authenticates from stored tokens', async () => {
    mockGetTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc1' })
    await hydrateAuth()
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('falls back to unauthenticated when there is no session', async () => {
    mockGetTokens.mockResolvedValue(null)
    await hydrateAuth()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
  })
})
