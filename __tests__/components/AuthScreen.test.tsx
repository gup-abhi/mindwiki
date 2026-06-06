import { fireEvent, render, screen } from '@testing-library/react-native'

import { AuthScreen } from '@/components/auth/AuthScreen'
import { useAuth } from '@/hooks/useAuth'

jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }))

const mockUseAuth = useAuth as jest.Mock
const submit = jest.fn()

beforeEach(() => {
  submit.mockReset()
  mockUseAuth.mockReturnValue({ submit, submitting: false, error: null })
})

describe('AuthScreen', () => {
  it('defaults to register and toggles to login', () => {
    render(<AuthScreen />)
    expect(screen.getByText('Create your account')).toBeTruthy()
    fireEvent.press(screen.getByTestId('auth-toggle'))
    expect(screen.getByText('Welcome back')).toBeTruthy()
  })

  it('requires a valid email and an 8+ char password before submitting', () => {
    render(<AuthScreen />)

    // password only — still blocked (email required)
    fireEvent.changeText(screen.getByTestId('auth-password'), 'password123')
    fireEvent.press(screen.getByTestId('auth-submit'))
    expect(submit).not.toHaveBeenCalled()

    fireEvent.changeText(screen.getByTestId('auth-email'), 'a@b.com')
    fireEvent.press(screen.getByTestId('auth-submit'))
    expect(submit).toHaveBeenCalledWith('register', 'a@b.com', 'password123')
  })

  it('toggles password visibility with the eye button', () => {
    render(<AuthScreen />)
    const field = screen.getByTestId('auth-password')
    expect(field.props.secureTextEntry).toBe(true)

    fireEvent.press(screen.getByTestId('auth-password-toggle'))
    expect(field.props.secureTextEntry).toBe(false)

    fireEvent.press(screen.getByTestId('auth-password-toggle'))
    expect(field.props.secureTextEntry).toBe(true)
  })

  it('shows the auth error', () => {
    mockUseAuth.mockReturnValue({ submit, submitting: false, error: 'Registration failed (409)' })
    render(<AuthScreen />)
    expect(screen.getByText('Registration failed (409)')).toBeTruthy()
  })
})
