import { render, screen, waitFor } from '@testing-library/react-native'

import RootLayout from '@/app/_layout'
import { initStorage } from '@/services/storage/bootstrap'
import { ok, err } from '@/types/result'

jest.mock('@/services/storage/bootstrap', () => ({ initStorage: jest.fn() }))
jest.mock('expo-router', () => {
  const { Text } = require('react-native')
  return { Stack: () => <Text>stack-rendered</Text> }
})

const mockInitStorage = initStorage as jest.Mock

describe('RootLayout storage gate', () => {
  beforeEach(() => mockInitStorage.mockReset())

  it('shows a loading state until storage init resolves', () => {
    mockInitStorage.mockReturnValue(new Promise(() => {})) // never resolves
    render(<RootLayout />)
    expect(screen.getByTestId('storage-loading')).toBeTruthy()
  })

  it('renders the app once storage is ready', async () => {
    mockInitStorage.mockResolvedValue(ok(undefined))
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('stack-rendered')).toBeTruthy())
  })

  it('shows an error state when storage init fails', async () => {
    mockInitStorage.mockResolvedValue(err('DB_INIT_FAILED', 'could not open db'))
    render(<RootLayout />)
    await waitFor(() => expect(screen.getByText('Storage error')).toBeTruthy())
    expect(screen.getByText('could not open db')).toBeTruthy()
  })
})
