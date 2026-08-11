import { fireEvent, render, screen } from '@testing-library/react-native'

import { AuthScreen } from '@/components/auth/AuthScreen'
import { useAuth } from '@/hooks/useAuth'

jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }))

const mockUseAuth = useAuth as jest.Mock
const submit = jest.fn()
const confirmPhrase = jest.fn()
const recover = jest.fn()

beforeEach(() => {
  submit.mockReset()
  confirmPhrase.mockReset()
  recover.mockReset()
  mockUseAuth.mockReturnValue({
    submit,
    submitting: false,
    error: null,
    pendingPhrase: null,
    confirmPhrase,
    recover,
  })
})

describe('AuthScreen', () => {
  it('declares intentional credential-manager semantics for register and login', () => {
    render(<AuthScreen />)
    expect(screen.getByTestId('auth-email').props.autoComplete).toBe('email')
    expect(screen.getByTestId('auth-email').props.textContentType).toBe('emailAddress')
    expect(screen.getByTestId('auth-password').props.autoComplete).toBe('new-password')
    expect(screen.getByTestId('auth-password').props.textContentType).toBe('newPassword')
    expect(screen.getByTestId('auth-password-confirm').props.autoComplete).toBe('new-password')

    fireEvent.press(screen.getByTestId('auth-toggle'))
    expect(screen.getByTestId('auth-password').props.autoComplete).toBe('current-password')
    expect(screen.getByTestId('auth-password').props.textContentType).toBe('password')
  })

  it('defaults to register and toggles to login', () => {
    render(<AuthScreen />)
    expect(screen.getByText('Create your account')).toBeTruthy()
    fireEvent.press(screen.getByTestId('auth-toggle'))
    expect(screen.getByText('Welcome back')).toBeTruthy()
  })

  it('can open directly in login mode from onboarding', () => {
    render(<AuthScreen initialMode="login" />)
    expect(screen.getByText('Welcome back')).toBeTruthy()
    expect(screen.queryByTestId('auth-password-confirm')).toBeNull()
  })

  it('requires a valid email and an 8+ char password before submitting', () => {
    render(<AuthScreen />)

    // password only — still blocked (email + matching confirm required)
    fireEvent.changeText(screen.getByTestId('auth-password'), 'password123')
    fireEvent.changeText(screen.getByTestId('auth-password-confirm'), 'password123')
    fireEvent.press(screen.getByTestId('auth-submit'))
    expect(submit).not.toHaveBeenCalled()

    fireEvent.changeText(screen.getByTestId('auth-email'), 'a@b.com')
    fireEvent.press(screen.getByTestId('auth-submit'))
    expect(submit).toHaveBeenCalledWith('register', 'a@b.com', 'password123')
  })

  it('blocks register until the confirmation password matches', () => {
    render(<AuthScreen />)
    fireEvent.changeText(screen.getByTestId('auth-email'), 'a@b.com')
    fireEvent.changeText(screen.getByTestId('auth-password'), 'password123')

    // mismatched confirm — blocked, with a hint
    fireEvent.changeText(screen.getByTestId('auth-password-confirm'), 'password124')
    expect(screen.getByText('Passwords don’t match.')).toBeTruthy()
    fireEvent.press(screen.getByTestId('auth-submit'))
    expect(submit).not.toHaveBeenCalled()

    // fix it — now allowed
    fireEvent.changeText(screen.getByTestId('auth-password-confirm'), 'password123')
    fireEvent.press(screen.getByTestId('auth-submit'))
    expect(submit).toHaveBeenCalledWith('register', 'a@b.com', 'password123')
  })

  it('has no confirmation field in login mode', () => {
    render(<AuthScreen />)
    fireEvent.press(screen.getByTestId('auth-toggle')) // → login
    expect(screen.queryByTestId('auth-password-confirm')).toBeNull()
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

  it('toggles the confirm-password visibility independently', () => {
    render(<AuthScreen />)
    const confirm = screen.getByTestId('auth-password-confirm')
    expect(confirm.props.secureTextEntry).toBe(true)

    fireEvent.press(screen.getByTestId('auth-password-confirm-toggle'))
    expect(confirm.props.secureTextEntry).toBe(false)
    // the main password field is unaffected
    expect(screen.getByTestId('auth-password').props.secureTextEntry).toBe(true)
  })

  it('shows the auth error', () => {
    mockUseAuth.mockReturnValue({
      submit,
      submitting: false,
      error: 'Registration failed (409)',
      pendingPhrase: null,
      confirmPhrase,
      recover,
    })
    render(<AuthScreen />)
    expect(screen.getByText('Registration failed (409)')).toBeTruthy()
  })

  it('shows the recovery phrase view after a successful register', () => {
    mockUseAuth.mockReturnValue({
      submit,
      submitting: false,
      error: null,
      pendingPhrase: { accountId: 'acc1', phrase: 'alpha bravo charlie' },
      confirmPhrase,
      recover,
    })
    render(<AuthScreen />)
    expect(screen.getByText('Save your recovery phrase')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()

    // Continue is gated on the "I've saved it" checkbox
    fireEvent.press(screen.getByTestId('recovery-continue'))
    expect(confirmPhrase).not.toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('recovery-saved-checkbox'))
    fireEvent.press(screen.getByTestId('recovery-continue'))
    expect(confirmPhrase).toHaveBeenCalled()
  })

  it('opens the recover flow from "Forgot password?" in login mode', () => {
    render(<AuthScreen />)
    fireEvent.press(screen.getByTestId('auth-toggle')) // → login
    fireEvent.press(screen.getByTestId('auth-forgot'))
    expect(screen.getByText('Recover your account')).toBeTruthy()
  })

  it('protects recovery phrase input while keeping credential autofill explicit', () => {
    render(<AuthScreen />)
    fireEvent.press(screen.getByTestId('auth-toggle'))
    fireEvent.press(screen.getByTestId('auth-forgot'))

    expect(screen.getByTestId('recover-email').props.autoComplete).toBe('email')
    expect(screen.getByTestId('recover-phrase').props.textContentType).toBe('none')
    expect(screen.getByTestId('recover-password').props.autoComplete).toBe('new-password')
    expect(screen.getByTestId('recover-password').props.textContentType).toBe('newPassword')
  })

  it('opens the QR scanner from "Pair with another device"', () => {
    render(<AuthScreen />)
    fireEvent.press(screen.getByTestId('auth-pair'))
    expect(screen.getByText('Scan the pairing QR')).toBeTruthy()
  })
})
