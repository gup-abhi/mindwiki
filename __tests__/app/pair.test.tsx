import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import Pair from '@/app/pair'
import { startPairing } from '@/services/sync/pairing'

const mockBack = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))
jest.mock('@/services/sync/pairing', () => ({ startPairing: jest.fn() }))
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = require('react-native')
  return { __esModule: true, default: ({ value }: { value: string }) => <Text testID="qr">{value}</Text> }
})

const mockStart = startPairing as jest.Mock

beforeEach(() => jest.clearAllMocks())

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
    fireEvent.press(screen.getByTestId('pair-back'))
    expect(mockBack).toHaveBeenCalled()
  })
})
