import { renderHook, act } from '@testing-library/react-native'

import { useAuth } from '@/hooks/useAuth'
import { register, loginNewDevice } from '@/services/auth/auth.service'

jest.mock('@/services/auth/auth.service', () => ({
  register: jest.fn(),
  loginNewDevice: jest.fn(),
}))

const mockRegister = register as jest.Mock
const mockLogin = loginNewDevice as jest.Mock

beforeEach(() => {
  mockRegister.mockReset()
  mockLogin.mockReset()
})

describe('useAuth', () => {
  it('registers with a trimmed email and reports success', async () => {
    mockRegister.mockResolvedValue({ success: true, data: { accountId: 'acc1' } })
    const { result } = renderHook(() => useAuth())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.submit('register', '  a@b.com ', 'password123')
    })

    expect(ok).toBe(true)
    expect(mockRegister).toHaveBeenCalledWith('a@b.com', 'password123')
    expect(result.current.error).toBeNull()
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
})
