import { renderHook, act } from '@testing-library/react-native'

import { useAuth } from '@/hooks/useAuth'
import {
  register,
  loginNewDevice,
  recoverAccount,
  changePassword,
  addRecoveryPhrase,
} from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'

jest.mock('@/services/auth/auth.service', () => ({
  register: jest.fn(),
  loginNewDevice: jest.fn(),
  recoverAccount: jest.fn(),
  changePassword: jest.fn(),
  addRecoveryPhrase: jest.fn(),
  preparePendingRecovery: jest.fn(),
  getPendingRecoveryPhrase: jest.fn(() => null),
}))

const mockRegister = register as jest.Mock
const mockLogin = loginNewDevice as jest.Mock
const mockRecover = recoverAccount as jest.Mock
const mockChange = changePassword as jest.Mock
const mockAddRecovery = addRecoveryPhrase as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  useAuthStore.setState({ status: 'loading', accountId: null })
  mockAddRecovery.mockResolvedValue({ success: true, data: { recoveryPhrase: 'a b c' } })
})

describe('useAuth', () => {
  it('register surfaces the recovery phrase and defers authentication', async () => {
    mockRegister.mockResolvedValue({ success: true, data: { accountId: 'acc1', recoveryPhrase: 'a b c' } })
    const { result } = renderHook(() => useAuth())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.submit('register', '  a@b.com ', 'password123')
    })

    expect(ok).toBe(true)
    expect(mockRegister).toHaveBeenCalledWith('a@b.com', 'password123')
    expect(result.current.pendingPhrase).toEqual({ accountId: 'acc1', phrase: 'a b c' })
    expect(useAuthStore.getState().status).not.toBe('authenticated') // not until confirm
  })

  it('confirmPhrase authenticates after the phrase is acknowledged', async () => {
    mockRegister.mockResolvedValue({ success: true, data: { accountId: 'acc1', recoveryPhrase: 'a b c' } })
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.submit('register', 'a@b.com', 'password123')
    })

    await act(async () => {
      await result.current.confirmPhrase()
    })
    expect(mockAddRecovery).toHaveBeenCalledWith('a b c')
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('surfaces the error message on failure', async () => {
    mockLogin.mockResolvedValue({ success: false, error: { code: 'LOGIN_FAILED', message: 'Login failed (401)' } })
    const { result } = renderHook(() => useAuth())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.submit('login', 'a@b.com', 'password123')
    })

    expect(ok).toBe(false)
    expect(mockLogin).toHaveBeenCalledWith('a@b.com', 'password123')
    expect(result.current.error).toBe('Login failed (401)')
  })

  it('recover sets a new password then authenticates', async () => {
    mockRecover.mockResolvedValue({ success: true, data: { accountId: 'acc1' } })
    mockChange.mockResolvedValue({ success: true, data: true })
    const { result } = renderHook(() => useAuth())

    const phrase = 'word '.repeat(12).trim()
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.recover(' a@b.com ', phrase, 'newpassword')
    })

    expect(ok).toBe(true)
    expect(mockRecover).toHaveBeenCalledWith('a@b.com', phrase)
    expect(mockChange).toHaveBeenCalledWith('newpassword')
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accountId: 'acc1' })
  })

  it('recover does not authenticate if changePassword fails', async () => {
    mockRecover.mockResolvedValue({ success: true, data: { accountId: 'acc1' } })
    mockChange.mockResolvedValue({ success: false, error: { code: 'X', message: 'nope' } })
    const { result } = renderHook(() => useAuth())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.recover('a@b.com', 'phrase', 'newpassword')
    })

    expect(ok).toBe(false)
    expect(result.current.error).toMatch(/new password/i)
    expect(useAuthStore.getState().status).not.toBe('authenticated')
  })
})
