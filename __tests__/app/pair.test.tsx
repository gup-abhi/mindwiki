import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Pair from '@/app/pair'
import { startPairing } from '@/services/sync/pairing'
import { authenticate } from '@/services/auth/biometric'

const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))
jest.mock('@/services/sync/pairing', () => ({ startPairing: jest.fn() }))
jest.mock('@/services/auth/biometric', () => ({ authenticate: jest.fn(async () => true) }))
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = require('react-native')
  return { __esModule: true, default: ({ value }: { value: string }) => <Text testID="qr">{value}</Text> }
})

const mockStart = startPairing as jest.Mock
const mockAuthenticate = authenticate as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthenticate.mockResolvedValue(true)
})

describe('Pair (device A QR)', () => {
  it('renders the QR with the pairing payload', async () => {
    mockStart.mockResolvedValue({ success: true, data: 'PAYLOAD' })
    render(<Pair />)
    await waitFor(() => expect(screen.getByTestId('qr')).toBeTruthy())
    expect(screen.getByText('PAYLOAD')).toBeTruthy()
  })

  it('shows an error when pairing cannot start', async () => {
    mockStart.mockResolvedValue({ success: false, error: { code: 'X', message: 'no' } })
    render(<Pair />)
    await waitFor(() => expect(screen.getByText(/Couldn’t start pairing/)).toBeTruthy())
    expect(screen.queryByTestId('qr')).toBeNull()
  })

  it('navigates back', async () => {
    mockStart.mockResolvedValue({ success: true, data: 'PAYLOAD' })
    render(<Pair />)
    // Let the mount-effect generate() settle inside act() before the test ends,
    // otherwise its async setState fires unwrapped and leaks into the next suite.
    await waitFor(() => expect(screen.getByTestId('qr')).toBeTruthy())
    fireEvent.press(screen.getByTestId('pair-back'))
    expect(mockBack).toHaveBeenCalled()
  })

  it('retries after a failure and shows the QR', async () => {
    mockStart
      .mockResolvedValueOnce({ success: false, error: { code: 'X', message: 'no' } })
      .mockResolvedValueOnce({ success: true, data: 'PAYLOAD' })
    render(<Pair />)
    await waitFor(() => expect(screen.getByTestId('pair-retry')).toBeTruthy())

    fireEvent.press(screen.getByTestId('pair-retry'))
    await waitFor(() => expect(screen.getByText('PAYLOAD')).toBeTruthy())
    expect(mockStart).toHaveBeenCalledTimes(2)
  })

  it('regenerates the code via reload', async () => {
    mockStart.mockResolvedValue({ success: true, data: 'PAYLOAD' })
    render(<Pair />)
    await waitFor(() => expect(screen.getByTestId('pair-reload')).toBeTruthy())

    fireEvent.press(screen.getByTestId('pair-reload'))
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2))
  })

  it('requires biometric auth before showing the QR', async () => {
    mockAuthenticate.mockResolvedValue(false)
    render(<Pair />)
    await waitFor(() => expect(screen.getByText(/Authentication required/)).toBeTruthy())
    expect(screen.queryByTestId('qr')).toBeNull()
    expect(mockStart).not.toHaveBeenCalled() // never minted a code
  })

  it('auto-refreshes the code at the 5-minute expiry', async () => {
    jest.useFakeTimers()
    try {
      mockStart.mockResolvedValue({ success: true, data: 'PAYLOAD' })
      render(<Pair />)
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0) // flush the initial generate
      })
      expect(mockStart).toHaveBeenCalledTimes(1)

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000)
      })
      expect(mockStart).toHaveBeenCalledTimes(2) // refreshed without a tap
    } finally {
      jest.useRealTimers()
    }
  })
})
