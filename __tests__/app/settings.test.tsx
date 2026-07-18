import { act, fireEvent, render, screen } from '@testing-library/react-native'

const flushPromises = () =>
  new Promise((resolve) => setTimeout(resolve, 0))

import Settings from '@/app/(tabs)/settings'
import { useAuth } from '@/hooks/useAuth'
import { useBiometricLock } from '@/hooks/useBiometricLock'
import { useDevices } from '@/hooks/useDevices'
import { useRecoverySetup } from '@/hooks/useRecoverySetup'
import { useSyncStatus } from '@/hooks/useSyncStatus'

const mockBack = jest.fn()
const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }))
jest.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: jest.fn() }))
jest.mock('@/hooks/useRecoverySetup', () => ({ useRecoverySetup: jest.fn() }))
jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }))
jest.mock('@/hooks/useBiometricLock', () => ({ useBiometricLock: jest.fn() }))
jest.mock('@/hooks/useDevices', () => ({ useDevices: jest.fn() }))
// Dev-only panel (data-backed); not under test here.
jest.mock('@/components/DevStreakDebug', () => ({ DevStreakDebug: () => null }))

// R4: logout is gated by a confirmation dialog. Capture the dialog and buttons
// so each test can drive the "Log out" button (or cancel) explicitly.
let alertOptions: { buttons: { text?: string; onPress?: () => void }[] }
let alertTitle: string
let alertMessage: string
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  alert: (title: string, message: string, buttons: { text?: string; onPress?: () => void }[]) => {
    alertTitle = title
    alertMessage = message
    alertOptions = { buttons }
  },
}))
const chooseAlert = (label: string) => {
  const btn = alertOptions.buttons.find((b) => b.text === label)
  btn?.onPress?.()
}

const mockSyncStatus = useSyncStatus as jest.Mock
const mockRecovery = useRecoverySetup as jest.Mock
const mockAuth = useAuth as jest.Mock
const mockBiometric = useBiometricLock as jest.Mock
const mockDevices = useDevices as jest.Mock

const syncNow = jest.fn()
const setup = jest.fn()
const logout = jest.fn()
const toggleLock = jest.fn()
const recoveryBase = { needsSetup: false, phrase: null, busy: false, error: null, setup, done: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  mockSyncStatus.mockReturnValue({ lastSynced: null, pending: 0, syncing: false, message: null, syncNow })
  mockRecovery.mockReturnValue(recoveryBase)
  mockAuth.mockReturnValue({ logout })
  mockBiometric.mockReturnValue({ enabled: true, capable: true, toggle: toggleLock })
  mockDevices.mockReturnValue({
    devices: [],
    loading: false,
    refresh: jest.fn(),
    currentDeviceId: null,
    logoutDevice: jest.fn(),
  })
})

describe('Settings', () => {
  it('shows sync status and runs sync now', () => {
    mockSyncStatus.mockReturnValue({ lastSynced: null, pending: 3, syncing: false, message: null, syncNow })
    render(<Settings />)
    expect(screen.getByText('Never')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    fireEvent.press(screen.getByTestId('settings-sync-now'))
    expect(syncNow).toHaveBeenCalled()
  })

  it('shows the post-sync message (e.g. already synced)', () => {
    mockSyncStatus.mockReturnValue({
      lastSynced: null,
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

  it('logs out after the confirmation dialog is confirmed (no pending entries)', async () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    expect(alertTitle).toBe('Log out?')
    // No pending entries → the unsynced-loss line is omitted.
    expect(alertMessage).not.toMatch(/haven’t synced/)
    expect(alertMessage).toMatch(/will be removed/)
    logout.mockResolvedValue(undefined)
    await act(async () => {
      chooseAlert('Log out')
      await flushPromises()
    })
    expect(logout).toHaveBeenCalled()
    expect(syncNow).not.toHaveBeenCalled() // nothing to flush
  })

  it('warns about unsynced entries and flushes before wiping when confirmed online', async () => {
    mockSyncStatus.mockReturnValue({ lastSynced: null, pending: 2, syncing: false, message: null, syncNow })
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    expect(alertMessage).toMatch(/2 entries haven’t synced yet and will be lost/)
    logout.mockResolvedValue(undefined)
    await act(async () => {
      chooseAlert('Log out')
      await flushPromises()
    })
    expect(syncNow).toHaveBeenCalled() // final flush attempted
    expect(logout).toHaveBeenCalled()
  })

  it('does not log out when the dialog is cancelled', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    chooseAlert('Cancel')
    expect(logout).not.toHaveBeenCalled()
  })

  it('opens the pair-a-device screen', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-pair'))
    expect(mockPush).toHaveBeenCalledWith('/pair')
  })

  it('opens the challenge screen', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-challenge'))
    expect(mockPush).toHaveBeenCalledWith('/challenge')
  })

  it('toggles the app lock', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-app-lock'))
    expect(toggleLock).toHaveBeenCalled()
  })

  it('lists paired devices', () => {
    mockDevices.mockReturnValue({
      devices: [{ id: 'd1', label: 'Pixel 7', platform: 'android', paired_at: Date.now() }],
      loading: false,
      refresh: jest.fn(),
      currentDeviceId: null,
      logoutDevice: jest.fn(),
    })
    render(<Settings />)
    expect(screen.getByText('Pixel 7')).toBeTruthy()
  })

  it('logs out another device from the list', () => {
    const logoutDevice = jest.fn()
    mockDevices.mockReturnValue({
      devices: [{ id: 'd1', label: 'Pixel 7', platform: 'android', paired_at: Date.now() }],
      loading: false,
      refresh: jest.fn(),
      currentDeviceId: 'other',
      logoutDevice,
    })
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-device-logout'))
    expect(logoutDevice).toHaveBeenCalledWith('d1')
  })

  it('shows no sign-out button for the current device, labels it instead', () => {
    mockDevices.mockReturnValue({
      devices: [{ id: 'd1', label: 'Pixel 7', platform: 'android', paired_at: Date.now() }],
      loading: false,
      refresh: jest.fn(),
      currentDeviceId: 'd1',
      logoutDevice: jest.fn(),
    })
    render(<Settings />)
    expect(screen.queryByTestId('settings-device-logout')).toBeNull()
    expect(screen.getByText('This device')).toBeTruthy()
  })

  it('shows an empty state when no other devices have paired', () => {
    render(<Settings />)
    expect(screen.getByText('No other devices have paired.')).toBeTruthy()
  })

  it('refreshes the paired-devices list', () => {
    const refresh = jest.fn()
    mockDevices.mockReturnValue({ devices: [], loading: false, refresh })
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-devices-refresh'))
    expect(refresh).toHaveBeenCalled()
  })

  it('offers the System/Light/Dark appearance options', () => {
    render(<Settings />)
    expect(screen.getByTestId('appearance-system')).toBeTruthy()
    expect(screen.getByTestId('appearance-light')).toBeTruthy()
    expect(screen.getByTestId('appearance-dark')).toBeTruthy()
  })
})
