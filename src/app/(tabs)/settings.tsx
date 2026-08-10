import { useState } from 'react'
import { Alert, Modal, StyleSheet, View } from 'react-native'
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
import { OnboardingCarousel } from '@/components/onboarding/OnboardingCarousel'
import { RecoveryPhraseView } from '@/components/auth/RecoveryPhraseView'
import { useAuth } from '@/hooks/useAuth'
import { useBiometricLock } from '@/hooks/useBiometricLock'
import { useDevices } from '@/hooks/useDevices'
import { useRecoverySetup } from '@/hooks/useRecoverySetup'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import { useNotifications } from '@/hooks/useNotifications'

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
  const { preferences: notificationPreferences, permission: notificationPermission, busy: notificationBusy, update: updateNotifications, enable: enableNotifications, openSystemSettings } = useNotifications()

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

  return (
    <Screen scroll>
      {phrase && (
        <Modal visible animationType="slide" onRequestClose={done}>
          <RecoveryPhraseView phrase={phrase} onConfirm={done} />
        </Modal>
      )}
      {showTour && (
        <Modal visible animationType="slide" onRequestClose={() => setShowTour(false)}>
          <OnboardingCarousel onDone={() => setShowTour(false)} />
        </Modal>
      )}

      <Text variant="title">Settings</Text>

      <Text variant="label" color="textMuted" style={styles.section}>
        Appearance
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

      <Text variant="label" color="textMuted" style={styles.section}>
        Notifications
      </Text>
      <Card variant="sunken">
        <View style={styles.row}>
          <View style={styles.lockText}>
            <Text variant="bodyStrong">Private reminders</Text>
            <Text variant="caption" color="textSecondary" style={styles.hint}>
              Generic lock-screen copy. Journal data stays on this device.
            </Text>
          </View>
          <Chip
            label={notificationPreferences.enabled ? 'On' : 'Off'}
            selected={notificationPreferences.enabled}
            onPress={() => {
              if (notificationPreferences.enabled) void updateNotifications({ enabled: false })
              else void enableNotifications()
            }}
            testID="settings-notifications-toggle"
          />
        </View>
        <Text variant="caption" color="textMuted" style={styles.hint}>
          Permission: {notificationPermission}
        </Text>
        {notificationPreferences.enabled && (
          <>
            <Text variant="caption" color="textSecondary" style={styles.hint}>
              Reminder topics
            </Text>
            <View style={styles.appearance}>
              <Chip label="Journal" selected={notificationPreferences.journal} onPress={() => void updateNotifications({ journal: !notificationPreferences.journal })} testID="settings-notifications-journal" />
              <Chip label="Challenge" selected={notificationPreferences.challenge} onPress={() => void updateNotifications({ challenge: !notificationPreferences.challenge })} testID="settings-notifications-challenge" />
              <Chip label="Insights" selected={notificationPreferences.insights} onPress={() => void updateNotifications({ insights: !notificationPreferences.insights })} testID="settings-notifications-insights" />
            </View>
            <Text variant="caption" color="textSecondary" style={styles.hint}>
              Reminder window: {notificationPreferences.reminderStartHour}:00–{notificationPreferences.reminderEndHour}:00
            </Text>
            <View style={styles.appearance}>
              <Chip label="Earlier" onPress={() => void updateNotifications({ reminderStartHour: Math.max(8, notificationPreferences.reminderStartHour - 1), reminderEndHour: Math.max(9, notificationPreferences.reminderEndHour - 1) })} testID="settings-notifications-earlier" />
              <Chip label="Later" onPress={() => void updateNotifications({ reminderStartHour: Math.min(22, notificationPreferences.reminderStartHour + 1), reminderEndHour: Math.min(23, notificationPreferences.reminderEndHour + 1) })} testID="settings-notifications-later" />
            </View>
            <Text variant="caption" color="textSecondary" style={styles.hint}>
              Quiet hours: {notificationPreferences.quietStartHour}:00–{notificationPreferences.quietEndHour}:00
            </Text>
            <View style={styles.appearance}>
              <Chip label="Momentum" selected={notificationPreferences.momentum} onPress={() => void updateNotifications({ momentum: !notificationPreferences.momentum })} testID="settings-notifications-momentum" />
              <Chip label="Patterns" selected={notificationPreferences.patterns} onPress={() => void updateNotifications({ patterns: !notificationPreferences.patterns })} testID="settings-notifications-patterns" />
            </View>
            <Text variant="caption" color="textMuted" style={styles.hint}>
              Preview: MindWiki — A quiet moment to check in, if it would help.
            </Text>
            <Text variant="caption" color="textMuted" style={styles.hint}>
              Why: reminders are planned on this device from activity timestamps only. Journal content never enters notification payloads.
            </Text>
          </>
        )}
        {(notificationPermission === 'blocked' || notificationPermission === 'denied') && (
          <View style={styles.action}>
            <Button title="Open system notification settings" variant="secondary" fullWidth onPress={() => void openSystemSettings()} testID="settings-notifications-system" />
          </View>
        )}
        {notificationPreferences.enabled && (
          <View style={styles.action}>
            <Button
              title="Pause reminders for one week"
              variant="secondary"
              fullWidth
              loading={notificationBusy}
              onPress={() => void updateNotifications({ pausedUntil: Date.now() + 7 * 86_400_000 })}
              testID="settings-notifications-pause"
            />
          </View>
        )}
      </Card>

      <Text variant="label" color="textMuted" style={styles.section}>
        Calm
      </Text>
      <Card variant="sunken" onPress={() => router.push('/breathe')} testID="settings-breathe">
        <Text variant="bodyStrong">Breathing exercise</Text>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          A one-minute box-breathing exercise to slow down. Nothing leaves your device.
        </Text>
      </Card>

      <Text variant="label" color="textMuted" style={styles.section}>
        Challenge
      </Text>
      <Card variant="sunken" onPress={() => router.push('/challenge')} testID="settings-challenge">
        <Text variant="bodyStrong">30-day challenge</Text>
        <Text variant="caption" color="textSecondary" style={styles.hint}>
          Commit to one thing daily for 30 days. Tap each day to keep the streak.
        </Text>
      </Card>

      <Text variant="label" color="textMuted" style={styles.section}>
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

      <Text variant="label" color="textMuted" style={styles.section}>
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

      <Text variant="label" color="textMuted" style={styles.section}>
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

      <Text variant="label" color="textMuted" style={styles.section}>
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
          <Text variant="label" color="textMuted" style={styles.section}>
            Developer
          </Text>
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
    appearance: { flexDirection: 'row', gap: t.spacing.sm },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: t.spacing.xs },
    lockText: { flex: 1, paddingRight: t.spacing.md },
    action: { marginTop: t.spacing.md },
    syncMessage: { textAlign: 'center', marginTop: t.spacing.md },
    error: { marginTop: t.spacing.sm },
    hint: { marginTop: t.spacing.xs },
    tourCard: { marginTop: t.spacing.lg },
    logout: { marginTop: t.spacing.xl, gap: t.spacing.md },
  })
