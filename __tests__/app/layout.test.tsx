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
jest.mock('expo-router', () => {
  const { Text } = require('react-native')
  return { Stack: () => <Text>stack-rendered</Text> }
})

const mockInitStorage = initStorage as jest.Mock

describe('RootLayout storage + auth gate', () => {
  beforeEach(() => {
    mockInitStorage.mockReset()
    useAuthStore.setState({ status: 'loading', accountId: null })
  })

  it('shows a loading state until storage init resolves', () => {
    mockInitStorage.mockReturnValue(new Promise(() => {})) // never resolves
    render(<RootLayout />)
    expect(screen.getByTestId('storage-loading')).toBeTruthy()
  })

  it('keeps loading after storage is ready until auth resolves', async () => {
    mockInitStorage.mockResolvedValue(ok(undefined))
    render(<RootLayout />)
    // storage ready but auth still 'loading' → still the spinner
    await waitFor(() => expect(screen.getByTestId('storage-loading')).toBeTruthy())
  })

  it('renders the app once storage is ready and the user is authenticated', async () => {
    mockInitStorage.mockResolvedValue(ok(undefined))
    useAuthStore.setState({ status: 'authenticated', accountId: 'acc1' })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
  })

  it('shows the auth screen when unauthenticated', async () => {
    mockInitStorage.mockResolvedValue(ok(undefined))
    useAuthStore.setState({ status: 'unauthenticated', accountId: null })
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByTestId('auth-submit')).toBeTruthy())
  })

  it('shows an error state when storage init fails', async () => {
    mockInitStorage.mockResolvedValue(err('DB_INIT_FAILED', 'could not open db'))
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('Storage error')).toBeTruthy())
    expect(screen.getByText('could not open db')).toBeTruthy()
  })
})
