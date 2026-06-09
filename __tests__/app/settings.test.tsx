import { fireEvent, render, screen } from '@testing-library/react-native'

import Settings from '@/app/(tabs)/settings'
import { useAuth } from '@/hooks/useAuth'
import { useRecoverySetup } from '@/hooks/useRecoverySetup'
import { useSyncStatus } from '@/hooks/useSyncStatus'

const mockBack = jest.fn()
const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }))
jest.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: jest.fn() }))
jest.mock('@/hooks/useRecoverySetup', () => ({ useRecoverySetup: jest.fn() }))
jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }))

const mockSyncStatus = useSyncStatus as jest.Mock
const mockRecovery = useRecoverySetup as jest.Mock
const mockAuth = useAuth as jest.Mock

const syncNow = jest.fn()
const setup = jest.fn()
const logout = jest.fn()
const recoveryBase = { needsSetup: false, phrase: null, busy: false, error: null, setup, done: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  mockSyncStatus.mockReturnValue({ lastPull: null, pending: 0, syncing: false, message: null, syncNow })
  mockRecovery.mockReturnValue(recoveryBase)
  mockAuth.mockReturnValue({ logout })
})

describe('Settings', () => {
  it('shows sync status and runs sync now', () => {
    mockSyncStatus.mockReturnValue({ lastPull: null, pending: 3, syncing: false, message: null, syncNow })
    render(<Settings />)
    expect(screen.getByText('Never')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    fireEvent.press(screen.getByTestId('settings-sync-now'))
    expect(syncNow).toHaveBeenCalled()
  })

  it('shows the post-sync message (e.g. already synced)', () => {
    mockSyncStatus.mockReturnValue({
      lastPull: null,
      pending: 0,
      syncing: false,
      message: 'Everything’s already synced.',
      syncNow,
    })
    render(<Settings />)
    expect(screen.getByTestId('settings-sync-message')).toBeTruthy()
    expect(screen.getByText('Everything’s already synced.')).toBeTruthy()
  })

  it('shows the recovery setup action when not configured', () => {
    mockRecovery.mockReturnValue({ ...recoveryBase, needsSetup: true })
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-setup-recovery'))
    expect(setup).toHaveBeenCalled()
  })

  it('shows recovery as set up when configured', () => {
    render(<Settings />)
    expect(screen.getByText('✓ Recovery phrase is set up')).toBeTruthy()
  })

  it('shows the phrase modal after setup', () => {
    mockRecovery.mockReturnValue({ ...recoveryBase, phrase: 'alpha bravo charlie' })
    render(<Settings />)
    expect(screen.getByText('Save your recovery phrase')).toBeTruthy()
  })

  it('logs out', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    expect(logout).toHaveBeenCalled()
  })

  it('opens the pair-a-device screen', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-pair'))
    expect(mockPush).toHaveBeenCalledWith('/pair')
  })
})
