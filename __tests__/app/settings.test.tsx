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
jest.mock('@/components/DevLegacyWikiBackfill', () => ({ DevLegacyWikiBackfill: () => null }))
jest.mock('@/components/DevGraphAudit', () => ({ DevGraphAudit: () => null }))
jest.mock('@/components/onboarding/OnboardingCarousel', () => ({
  OnboardingCarousel: ({ onDone }: { onDone: () => void }) => {
    const React = require('react')
    const { Text, Pressable } = require('react-native')
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Text, { testID: 'settings-tour-content' }, 'A journal that thinks with you'),
      React.createElement(Pressable, { testID: 'settings-tour-done', onPress: onDone }),
    )
  },
}))

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
const deleteAccount = jest.fn()
const toggleLock = jest.fn()
const recoveryBase = { needsSetup: false, phrase: null, busy: false, error: null, setup, done: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  mockSyncStatus.mockReturnValue({ lastSynced: null, pending: 0, syncing: false, message: null, syncNow })
  mockRecovery.mockReturnValue(recoveryBase)
  mockAuth.mockReturnValue({ logout, deleteAccount, error: null })
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

  it('verifies sync before logging out even when the displayed pending count is zero', async () => {
    syncNow.mockResolvedValue(true)
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    expect(alertTitle).toBe('Log out?')
    expect(alertMessage).toMatch(/sync any waiting changes/i)
    logout.mockResolvedValue(undefined)
    await act(async () => {
      chooseAlert('Sync and log out')
      await flushPromises()
    })
    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('syncs pending changes before wiping when confirmed online', async () => {
    syncNow.mockResolvedValue(true)
    mockSyncStatus.mockReturnValue({ lastSynced: null, pending: 2, syncing: false, message: null, syncNow })
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    expect(alertMessage).toMatch(/2 changes are waiting to upload/i)
    logout.mockResolvedValue(undefined)
    await act(async () => {
      chooseAlert('Sync and log out')
      await flushPromises()
    })
    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('keeps the account and local data when sync cannot be verified', async () => {
    syncNow.mockResolvedValue(false)
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    await act(async () => {
      chooseAlert('Sync and log out')
      await flushPromises()
    })

    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(logout).not.toHaveBeenCalled()
    expect(screen.getByTestId('settings-logout-error')).toBeTruthy()
    expect(screen.getByText(/couldn’t confirm that all changes are synced/i)).toBeTruthy()
  })

  it('does not log out when the dialog is cancelled', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-logout'))
    chooseAlert('Cancel')
    expect(logout).not.toHaveBeenCalled()
  })

  it('deletes the account only after two destructive confirmations without syncing first', async () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-delete-account'))
    expect(alertTitle).toBe('Delete account permanently?')
    expect(alertMessage).toMatch(/encrypted sync backup/)
    chooseAlert('Delete account')
    expect(alertTitle).toBe('Confirm permanent deletion')
    deleteAccount.mockResolvedValue(true)
    await act(async () => {
      chooseAlert('Delete account')
      await flushPromises()
    })
    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('does not delete the account when either confirmation is cancelled', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-delete-account'))
    chooseAlert('Delete account')
    chooseAlert('Cancel')
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('returns the delete button to normal when deletion cannot start', async () => {
    deleteAccount.mockResolvedValue(false)
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-delete-account'))
    chooseAlert('Delete account')
    await act(async () => {
      chooseAlert('Delete account')
      await flushPromises()
    })
    expect(screen.getByText('Delete account')).toBeTruthy()
  })

  it('shows a retry-later error while the account remains open', () => {
    mockAuth.mockReturnValue({
      logout,
      deleteAccount,
      error: 'Could not reach the server. Your account is unchanged — try again later.',
    })
    render(<Settings />)
    expect(screen.getByTestId('settings-delete-account-error')).toBeTruthy()
    expect(screen.getByText('Could not reach the server. Your account is unchanged — try again later.')).toBeTruthy()
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
    chooseAlert('Log out')
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

  it('opens the welcome tour on the first press', () => {
    render(<Settings />)
    expect(screen.queryByTestId('settings-tour-content')).toBeNull()
    fireEvent.press(screen.getByTestId('settings-replay-tour'))
    expect(screen.getByTestId('settings-tour-content')).toBeTruthy()
  })

  it('opens the development design preview from the developer section', () => {
    render(<Settings />)
    fireEvent.press(screen.getByTestId('settings-design-preview'))
    expect(screen.getByTestId('settings-design-preview-overlay')).toBeTruthy()
    expect(screen.getByTestId('design-preview-close')).toBeTruthy()
  })

  it('offers the System/Light/Dark appearance options', () => {
    render(<Settings />)
    expect(screen.getByTestId('appearance-system')).toBeTruthy()
    expect(screen.getByTestId('appearance-light')).toBeTruthy()
    expect(screen.getByTestId('appearance-dark')).toBeTruthy()
  })

  it('exposes the settings sections as accessible headers', () => {
    render(<Settings />)
    expect(screen.getByRole('header', { name: 'Appearance' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Security' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Sync' })).toBeTruthy()
    expect(screen.getByRole('header', { name: 'Account' })).toBeTruthy()
  })

  it('keeps preference controls at the full interaction target', () => {
    render(<Settings />)
    expect(screen.getByTestId('appearance-system').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ minHeight: 48 })])
    )
    expect(screen.getByTestId('settings-app-lock').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ minHeight: 48 })])
    )
  })

  it('keeps paired-device rows readable and navigable', () => {
    const refresh = jest.fn()
    mockDevices.mockReturnValue({
      devices: [{ id: 'd1', label: 'Pixel 7', platform: 'android', paired_at: Date.now() }],
      loading: false,
      refresh,
      currentDeviceId: 'other',
      logoutDevice: jest.fn(),
    })
    render(<Settings />)
    expect(screen.getByTestId('settings-device').props.style).toEqual(
      expect.objectContaining({ minHeight: 48 })
    )
    expect(screen.getByTestId('settings-device-logout').props.accessibilityRole).toBe('button')
  })
})
