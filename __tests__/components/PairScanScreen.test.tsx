import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { PairScanScreen } from '@/components/auth/PairScanScreen'
import { redeemPairing } from '@/services/sync/pairing'
import { useCameraPermissions } from 'expo-camera'

jest.mock('@/services/sync/pairing', () => ({ redeemPairing: jest.fn() }))

const mockRedeem = redeemPairing as jest.Mock
const mockPerms = useCameraPermissions as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockPerms.mockReturnValue([{ granted: true }, jest.fn()])
})

describe('PairScanScreen', () => {
  it('redeems the scanned QR', async () => {
    mockRedeem.mockResolvedValue({ success: true, data: { accountId: 'acc1' } })
    render(<PairScanScreen onCancel={jest.fn()} />)
    fireEvent.press(screen.getByTestId('mock-barcode'))
    await waitFor(() => expect(mockRedeem).toHaveBeenCalledWith('SCANNED_QR'))
  })

  it('surfaces an error and re-arms on a failed scan', async () => {
    mockRedeem.mockResolvedValue({ success: false, error: { code: 'X', message: 'no' } })
    render(<PairScanScreen onCancel={jest.fn()} />)
    fireEvent.press(screen.getByTestId('mock-barcode'))
    await waitFor(() => expect(screen.getByText(/Couldn’t pair/)).toBeTruthy())
  })

  it('asks for permission when not granted', () => {
    const request = jest.fn()
    mockPerms.mockReturnValue([{ granted: false }, request])
    render(<PairScanScreen onCancel={jest.fn()} />)
    fireEvent.press(screen.getByTestId('pair-scan-grant'))
    expect(request).toHaveBeenCalled()
  })

  it('cancels back to sign in', () => {
    const onCancel = jest.fn()
    render(<PairScanScreen onCancel={onCancel} />)
    fireEvent.press(screen.getByTestId('pair-scan-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})
