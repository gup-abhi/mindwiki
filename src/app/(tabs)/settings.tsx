import { useEffect, useState } from 'react'
import { Alert, BackHandler, Modal, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button, Card, Chip, IconButton, Screen, Text } from '@/components/ui'
import { type Theme, type ThemePreference, useThemePreference, useThemedStyles } from '@/theme'
import { DevStreakDebug } from '@/components/DevStreakDebug'
import { DevSeedDigest } from '@/components/DevSeedDigest'
import { DevSeedTrend } from '@/components/DevSeedTrend'
import { DevDriftReport } from '@/components/DevDriftReport'
import { DevReGround } from '@/components/DevReGround'
import { DevConnectionCleanup } from '@/components/DevConnectionCleanup'
import { DevEmotionPlaceholderBackfill } from '@/components/DevEmotionPlaceholderBackfill'
import { DevEmbedProbe } from '@/components/DevEmbedProbe'
import { DevWikiAudit } from '@/components/DevWikiAudit'
import { DevLegacyWikiBackfill } from '@/components/DevLegacyWikiBackfill'
import { DevGraphAudit } from '@/components/DevGraphAudit'
import { DesignPreview } from '@/components/dev/DesignPreview'
import { OnboardingCarousel } from '@/components/onboarding/OnboardingCarousel'
import { RecoveryPhraseView } from '@/components/auth/RecoveryPhraseView'
import { useAuth } from '@/hooks/useAuth'
import { useBiometricLock } from '@/hooks/useBiometricLock'
import { useDevices } from '@/hooks/useDevices'
import { useRecoverySetup } from '@/hooks/useRecoverySetup'
import { useSyncStatus } from '@/hooks/useSyncStatus'

function timeAgo(ms: number | null): string {
  if (!ms) return 'Never'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export default function Settings() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { lastSynced, pending, syncing, message, syncNow } = useSyncStatus()
  const { needsSetup, phrase, busy, error, setup, done } = useRecoverySetup()
  const { preference, setPreference } = useThemePreference()
  const { enabled: lockEnabled, capable: lockCapable, toggle: toggleLock } = useBiometricLock()
  const {
    devices,
    loading: devicesLoading,
    refresh: refreshDevices,
    currentDeviceId,
    identityResolved,
    busyDeviceId,
    error: devicesError,
    logoutDevice,
  } = useDevices()
  const { logout, deleteAccount, error: authError } = useAuth()
  const deviceIdentityReady = identityResolved === undefined ? currentDeviceId !== null : identityResolved

  // Logout is destructive (local wipe). Confirm first (R4), then require a
  // successful sync with an empty upload queue before deleting local data.
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const confirmDeleteAccount = () => {
    if (deletingAccount) return
    Alert.alert(
      'Delete account permanently?',
      'Your account, encrypted sync backup, this-device journal, and unsynced entries will be permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirm permanent deletion',
              'Tap Delete account again to erase this account and all of its remote data.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete account',
                  style: 'destructive',
                  onPress: async () => {
                    setDeletingAccount(true)
                    const started = await deleteAccount()
                    if (!started) setDeletingAccount(false)
                  },
                },
              ]
            )
          },
        },
      ]
    )
  }
  const confirmLogout = () => {
    if (loggingOut) return
    const base =
      'MindWiki will sync any waiting changes, then remove this device’s journal. Your account data stays encrypted in your sync backup.'
    const warning = pending > 0
      ? `${pending} ${pending === 1 ? 'change is' : 'changes are'} waiting to upload. `
      : ''
    Alert.alert('Log out?', `${warning}${base}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sync and log out',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true)
          setLogoutError(null)
          const fullySynced = await syncNow()
          if (!fullySynced) {
            setLogoutError('We couldn’t confirm that all changes are synced. Your account and journal remain on this device. Check your connection and try again.')
            setLoggingOut(false)
            return
          }
          try {
            await logout()
          } catch {
            setLogoutError('Log out couldn’t finish. Please try again.')
            setLoggingOut(false)
          }
        },
      },
    ])
  }
  const [showTour, setShowTour] = useState(false)
  const [showDesignPreview, setShowDesignPreview] = useState(false)

  useEffect(() => {
    if (!showTour && !showDesignPreview) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showDesignPreview) setShowDesignPreview(false)
      else setShowTour(false)
      return true
    })
    return () => subscription.remove()
  }, [showTour, showDesignPreview])

  return (
    <View style={styles.root}>
      <Screen scroll>
        {phrase && (
          <Modal visible animationType="slide" onRequestClose={done}>
            <RecoveryPhraseView phrase={phrase} onConfirm={done} />
          </Modal>
        )}

        <Text variant="title">Settings</Text>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Appearance
      </Text>
      <Card variant="sunken" style={styles.appearanceCard}>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          Choose how MindWiki looks on this device.
        </Text>
        <View style={styles.appearance}>
          {APPEARANCE_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={preference === o.value}
              onPress={() => setPreference(o.value)}
              testID={`appearance-${o.value}`}
            />
          ))}
        </View>
      </Card>

      <Card
        variant="sunken"
        onPress={() => setShowTour(true)}
        testID="settings-replay-tour"
        style={styles.tourCard}
      >
        <Text variant="bodyStrong">Replay the welcome tour</Text>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          See the introduction again — no download required.
        </Text>
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Notifications
      </Text>
      <Card variant="sunken" onPress={() => router.push('/notification-settings')} testID="settings-notification-settings">
        <Text variant="bodyStrong">Notification settings</Text>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          Choose a private reflection routine and manage notification permission.
        </Text>
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Calm
      </Text>
      <Card variant="sunken" onPress={() => router.push('/breathe')} testID="settings-breathe">
        <Text variant="bodyStrong">Breathing exercise</Text>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          A one-minute box-breathing exercise to slow down. Nothing leaves your device.
        </Text>
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Challenge
      </Text>
      <Card variant="sunken" onPress={() => router.push('/challenge')} testID="settings-challenge">
        <Text variant="bodyStrong">30-day challenge</Text>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          Commit to one thing daily for 30 days. Tap each day to keep the streak.
        </Text>
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Security
      </Text>
      <Card variant="sunken">
        <View style={styles.row}>
          <View style={styles.lockText}>
            <Text variant="bodyStrong">Require unlock to open</Text>
            <Text variant="caption" color="textSecondary" style={styles.hint}>
              {lockCapable
                ? 'Use biometrics or your device PIN to open the app and to pair a new device.'
                : 'Set up biometrics or a device PIN to enable this.'}
            </Text>
          </View>
          <Chip
            label={lockEnabled ? 'On' : 'Off'}
            selected={lockEnabled}
            onPress={() => {
              if (lockCapable) void toggleLock()
            }}
            testID="settings-app-lock"
          />
        </View>
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Sync
      </Text>
      <Card variant="sunken">
        <View style={styles.row}>
          <Text variant="body" color="textSecondary">
            Last synced
          </Text>
          <Text variant="bodyStrong">{timeAgo(lastSynced)}</Text>
        </View>
        <View style={styles.row}>
          <Text variant="body" color="textSecondary">
            Waiting to upload
          </Text>
          <Text variant="bodyStrong">{pending === 0 ? 'All synced' : `${pending}`}</Text>
        </View>
        <View style={styles.action}>
          <Button title="Sync now" loading={syncing} fullWidth onPress={() => syncNow()} testID="settings-sync-now" />
        </View>
        {message && (
          <Text variant="caption" color="success" style={styles.syncMessage} testID="settings-sync-message">
            {message}
          </Text>
        )}
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Recovery phrase
      </Text>
      <Card variant="sunken">
        {needsSetup ? (
          <>
            <Text variant="body" color="textSecondary">
              Set up a recovery phrase so you can get back in if you forget your password.
            </Text>
            {error && (
              <Text variant="caption" color="danger" style={styles.error}>
                {error}
              </Text>
            )}
            <View style={styles.action}>
              <Button
                title="Set up recovery phrase"
                loading={busy}
                fullWidth
                onPress={() => setup()}
                testID="settings-setup-recovery"
              />
            </View>
          </>
        ) : (
          <Text variant="bodyStrong">✓ Recovery phrase is set up</Text>
        )}
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Account
      </Text>
      <Card variant="sunken" onPress={() => router.push('/pair')} testID="settings-pair">
        <Text variant="bodyStrong">Pair a new device</Text>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          Show a QR to sign in on another device without your password.
        </Text>
      </Card>
      <View style={styles.sectionRow}>
        <Text variant="label" color="textMuted" style={styles.sectionLabel}>
          Paired devices
        </Text>
        <IconButton
          name="refresh"
          size={18}
          onPress={() => void refreshDevices()}
          accessibilityLabel="Refresh paired devices"
          testID="settings-devices-refresh"
        />
      </View>
      <Card variant="sunken">
        {devicesError && (
          <Text variant="caption" color="danger" style={styles.error} testID="settings-devices-error">
            {devicesError}
          </Text>
        )}
        {devices.length === 0 ? (
          <Text variant="body" color="textSecondary">
            {devicesLoading ? 'Loading…' : 'No other devices have paired.'}
          </Text>
        ) : (
          devices.map((d) => {
            const isCurrent = d.id === currentDeviceId
            return (
              <View key={d.id} style={styles.row} testID="settings-device">
                <Text variant="bodyStrong">{d.label}</Text>
                <View style={styles.deviceMeta}>
                  <Text variant="caption" color="textSecondary">
                    {timeAgo(d.paired_at)}
                  </Text>
                  {isCurrent ? (
                    <Text variant="caption" color="textMuted">
                      This device
                    </Text>
                  ) : deviceIdentityReady && busyDeviceId !== d.id ? (
                    <IconButton
                      name="log-out-outline"
                      size={18}
                      onPress={() => Alert.alert(
                        `Log out ${d.label}?`,
                        'This signs out only this other device.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Log out', style: 'destructive', onPress: () => void logoutDevice(d.id) },
                        ]
                      )}
                      accessibilityLabel={`Log out ${d.label}`}
                      testID="settings-device-logout"
                    />
                  ) : deviceIdentityReady && busyDeviceId === d.id ? (
                    <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
                      Signing out…
                    </Text>
                  ) : null}
                </View>
              </View>
            )
          })
        )}
      </Card>

      {__DEV__ && (
        <>
          <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
            Developer
          </Text>
          <Card variant="sunken" onPress={() => setShowDesignPreview(true)} testID="settings-design-preview">
            <Text variant="bodyStrong">Design preview</Text>
            <Text variant="caption" color="textSecondary" style={styles.hint}>
              Inspect Quiet Editorial components with static, non-sensitive examples.
            </Text>
          </Card>
          <DevStreakDebug />
          <DevSeedDigest />
          <DevSeedTrend />
          <DevDriftReport />
          <DevReGround />
          <DevConnectionCleanup />
          <DevEmotionPlaceholderBackfill />
          <DevEmbedProbe />
<DevWikiAudit />
          <DevLegacyWikiBackfill />
          <DevGraphAudit />
        </>
      )}

      <View style={styles.logout}>
        <Button title="Log out" variant="destructive" fullWidth loading={loggingOut} onPress={confirmLogout} testID="settings-logout" />
        {logoutError && (
          <Text variant="caption" color="danger" style={styles.error} testID="settings-logout-error">
            {logoutError}
          </Text>
        )}
        <Button title="Delete account" variant="destructive" fullWidth loading={deletingAccount} onPress={confirmDeleteAccount} testID="settings-delete-account" />
        {authError && (
          <Text variant="caption" color="danger" style={styles.error} testID="settings-delete-account-error">
            {authError}
          </Text>
        )}
      </View>
      </Screen>
      {showTour && (
        <View style={styles.tourOverlay} testID="settings-tour-overlay">
          <OnboardingCarousel onDone={() => setShowTour(false)} />
        </View>
      )}
      {showDesignPreview && (
        <View style={styles.tourOverlay} testID="settings-design-preview-overlay">
          <DesignPreview onClose={() => setShowDesignPreview(false)} />
        </View>
      )}
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    section: { marginTop: t.spacing['2xl'], marginBottom: t.spacing.sm, textTransform: 'uppercase' },
    sectionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: t.spacing['2xl'],
      marginBottom: t.spacing.sm,
    },
    sectionLabel: { textTransform: 'uppercase' },
    deviceMeta: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
    appearanceCard: { marginTop: t.spacing.sm },
    appearance: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
    row: {
      minHeight: 48,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: t.spacing.sm,
    },
    lockText: { flex: 1, paddingRight: t.spacing.md },
    action: { marginTop: t.spacing.lg },
    syncMessage: { textAlign: 'center', marginTop: t.spacing.md },
    error: { marginTop: t.spacing.sm },
    hint: { marginTop: t.spacing.xs },
    tourCard: { marginTop: t.spacing.lg },
    root: { flex: 1 },
    tourOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: t.colors.bg },
    logout: { marginTop: t.spacing['2xl'], gap: t.spacing.md },
  })
