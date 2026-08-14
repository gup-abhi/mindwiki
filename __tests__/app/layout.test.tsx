import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import RootLayout from '@/app/_layout'
import { initStorage } from '@/services/storage/bootstrap'
import { isIntroOnboardingDone, markIntroOnboardingDone } from '@/services/onboarding/intro'
import { useAuthStore } from '@/store/auth.store'
import { ok, err } from '@/types/result'

jest.mock('@/services/storage/bootstrap', () => ({ initStorage: jest.fn() }))
// hydrateAuth is exercised in auth.service.test; here we drive auth state directly.
const mockCanReturnToAccount = jest.fn()
const mockDeleteAccount = jest.fn()
const mockReturnToAccount = jest.fn()
jest.mock('@/services/auth/auth.service', () => ({
  canReturnToAccountFromDeletion: (...args: unknown[]) => mockCanReturnToAccount(...args),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
  hydrateAuth: jest.fn(),
  loginNewDevice: jest.fn(),
  register: jest.fn(),
  returnToAccountFromDeletion: (...args: unknown[]) => mockReturnToAccount(...args),
}))
jest.mock('@/hooks/useSync', () => ({ useSync: jest.fn() }))
// Intro onboarding is install-level because it runs before an account DB exists.
jest.mock('@/services/onboarding/intro', () => ({
  isIntroOnboardingDone: jest.fn().mockResolvedValue(false),
  markIntroOnboardingDone: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/services/onboarding/first-run', () => ({}))
jest.mock('@/services/llm/model-manager', () => ({
  areModelsReady: jest.fn().mockResolvedValue(true),
}))
// ThemeProvider hydrates the saved theme preference from settings once
// authenticated; stub it so the gate test doesn't touch the encrypted DB.
jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(() => Promise.resolve({ success: false, error: { code: 'X', message: 'x' } })),
  setSetting: jest.fn(() => Promise.resolve({ success: true, data: undefined })),
}))
jest.mock('expo-router', () => {
  const { Text } = require('react-native')
  return {
    Stack: () => <Text>stack-rendered</Text>,
    useRouter: () => ({ push: jest.fn() }),
  }
})
// useFirstRunRedirect fires router.replace; stub it in layout tests so the
// route tree doesn't change during gate tests.
jest.mock('@/hooks/useFirstRunRedirect', () => ({
  useFirstRunRedirect: jest.fn(),
  resetFirstRunRedirect: jest.fn(),
}))

const mockInitStorage = initStorage as jest.Mock
const mockIsIntroOnboardingDone = isIntroOnboardingDone as jest.Mock
const mockMarkIntroOnboardingDone = markIntroOnboardingDone as jest.Mock
let appStateHandler: ((state: AppStateStatus) => void) | null = null

describe('RootLayout — auth gate then DB open', () => {
  beforeAll(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
      appStateHandler = handler
      return { remove: jest.fn() }
    })
  })
  afterAll(() => jest.restoreAllMocks())
  beforeEach(() => {
    mockInitStorage.mockReset()
    mockInitStorage.mockResolvedValue(ok(undefined))
    mockCanReturnToAccount.mockReset()
    mockCanReturnToAccount.mockResolvedValue(ok(false))
    mockDeleteAccount.mockReset()
    mockReturnToAccount.mockReset()
    mockIsIntroOnboardingDone.mockReset().mockResolvedValue(true)
    mockMarkIntroOnboardingDone.mockReset().mockResolvedValue(undefined)
    useAuthStore.setState({ status: 'loading', accountId: null, isNewAccount: false })
  })

  it('shows a spinner while the session is resolving', async () => {
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('storage-loading')).toBeTruthy())
  })

  it('covers every route while inactive or backgrounded', async () => {
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('auth-submit')).toBeTruthy())
    act(() => appStateHandler?.('active'))
    expect(screen.queryByTestId('privacy-cover')).toBeNull()

    act(() => appStateHandler?.('background'))
    expect(screen.getByTestId('privacy-cover')).toBeTruthy()

    act(() => appStateHandler?.('active'))
    expect(screen.queryByTestId('privacy-cover')).toBeNull()
  })

  it('shows the auth screen when unauthenticated after intro — and does NOT open the DB', async () => {
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('auth-submit')).toBeTruthy())
    expect(mockInitStorage).not.toHaveBeenCalled() // DB stays closed until auth
  })

  it('shows intro onboarding before registration on a fresh install', async () => {
    mockIsIntroOnboardingDone.mockResolvedValue(false)
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    render(<RootLayout />)

    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeTruthy())
    expect(screen.queryByTestId('auth-submit')).toBeNull()
    expect(mockInitStorage).not.toHaveBeenCalled()
  })

  it('continues from intro onboarding to registration and persists completion', async () => {
    mockIsIntroOnboardingDone.mockResolvedValue(false)
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeTruthy())

    for (let i = 0; i < 6; i++) fireEvent.press(screen.getByTestId('onboarding-next'))

    await waitFor(() => expect(screen.getByText('Create your account')).toBeTruthy())
    expect(mockMarkIntroOnboardingDone).toHaveBeenCalledTimes(1)
  })

  it('opens login from intro onboarding for returning users', async () => {
    mockIsIntroOnboardingDone.mockResolvedValue(false)
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('onboarding-sign-in')).toBeTruthy())

    fireEvent.press(screen.getByTestId('onboarding-sign-in'))

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy())
    expect(mockMarkIntroOnboardingDone).toHaveBeenCalledTimes(1)
  })

  it('opens the DB and renders the app once authenticated', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
    expect(mockInitStorage).toHaveBeenCalledTimes(1)
  })

  it('backfills intro completion for an existing authenticated install', async () => {
    mockIsIntroOnboardingDone.mockResolvedValue(false)
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    render(<RootLayout />)

    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
    await waitFor(() => expect(mockMarkIntroOnboardingDone).toHaveBeenCalledTimes(1))
  })

  it('enters the app directly after a brand-new account so the writing redirect can run', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1', isNewAccount: true })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
    expect(screen.queryByTestId('onboarding')).toBeNull()
  })

  it('enters the app directly for an existing account (login/returning session)', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1', isNewAccount: false })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
    expect(screen.queryByTestId('onboarding')).toBeNull()
  })

  it('hides the return action when remote deletion already started', async () => {
    useAuthStore.setState({ status: 'deleting', accountId: 'acc1' })
    render(<RootLayout />)

    await waitFor(() => expect(mockCanReturnToAccount).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('account-deletion-return')).toBeNull()
    expect(screen.getByTestId('account-deletion-retry')).toBeTruthy()
  })

  it('offers a safe return action while deletion is stuck locally', async () => {
    useAuthStore.setState({ status: 'deleting', accountId: 'acc1' })
    mockCanReturnToAccount.mockResolvedValue(ok(true))
    let finishReturn: (() => void) | undefined
    mockReturnToAccount.mockReturnValue(
      new Promise((resolve) => {
        finishReturn = () => resolve(ok(true))
      })
    )
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('account-deletion-return')).toBeTruthy())
    fireEvent.press(screen.getByTestId('account-deletion-return'))
    await waitFor(() => expect(mockReturnToAccount).toHaveBeenCalledTimes(1))
    expect(mockDeleteAccount).not.toHaveBeenCalled()
    expect(screen.getByText('Retry deletion')).toBeTruthy()
    expect(screen.queryByText('Return to account')).toBeNull()
    expect(mockInitStorage).not.toHaveBeenCalled()
    await act(async () => finishReturn?.())
  })

  it('shows an error state when the DB fails to open', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockInitStorage.mockResolvedValue(err('DB_INIT_FAILED', 'could not open db'))
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('Storage error')).toBeTruthy())
    expect(screen.getByText('could not open db')).toBeTruthy()
  })
})
