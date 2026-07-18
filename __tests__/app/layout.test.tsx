import { render, screen, waitFor } from '@testing-library/react-native'

import RootLayout from '@/app/_layout'
import { initStorage } from '@/services/storage/bootstrap'
import { useAuthStore } from '@/store/auth.store'
import { ok, err } from '@/types/result'

jest.mock('@/services/storage/bootstrap', () => ({ initStorage: jest.fn() }))
// hydrateAuth is exercised in auth.service.test; here we drive auth state directly.
jest.mock('@/services/auth/auth.service', () => ({
  hydrateAuth: jest.fn(),
  register: jest.fn(),
  loginNewDevice: jest.fn(),
}))
jest.mock('@/hooks/useSync', () => ({ useSync: jest.fn() }))
// The welcome tour + guided path are for brand-new accounts only, gated on the
// auth store's isNewAccount. beginOnboardingModelDownload is fired from the
// carousel CTA; stub it so the gate tests don't touch the model manager.
jest.mock('@/services/onboarding/first-run', () => ({
  beginOnboardingModelDownload: jest.fn(),
  isFirstRunTourDone: jest.fn().mockResolvedValue(false),
  isOnboardingIncomplete: jest.fn().mockResolvedValue(false),
  markFirstRunTourDone: jest.fn().mockResolvedValue(undefined),
}))
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

describe('RootLayout — auth gate then DB open', () => {
  beforeEach(() => {
    mockInitStorage.mockReset()
    mockInitStorage.mockResolvedValue(ok(undefined))
    useAuthStore.setState({ status: 'loading', accountId: null, isNewAccount: false })
  })

  it('shows a spinner while the session is resolving', () => {
    render(<RootLayout />)
    expect(screen.getByTestId('storage-loading')).toBeTruthy()
  })

  it('shows the auth screen when unauthenticated — and does NOT open the DB', async () => {
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('auth-submit')).toBeTruthy())
    expect(mockInitStorage).not.toHaveBeenCalled() // DB stays closed until auth
  })

  it('opens the DB and renders the app once authenticated', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
    expect(mockInitStorage).toHaveBeenCalledTimes(1)
  })

  it('shows the welcome tour for a brand-new account, before the app', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1', isNewAccount: true })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeTruthy())
    expect(screen.queryByText('stack-rendered')).toBeNull()
  })

  it('skips the welcome tour for an existing account (login/returning session)', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1', isNewAccount: false })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
    expect(screen.queryByTestId('onboarding')).toBeNull()
  })

  it('shows an error state when the DB fails to open', async () => {
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    mockInitStorage.mockResolvedValue(err('DB_INIT_FAILED', 'could not open db'))
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('Storage error')).toBeTruthy())
    expect(screen.getByText('could not open db')).toBeTruthy()
  })
})
