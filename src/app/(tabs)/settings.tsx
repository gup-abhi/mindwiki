import { Modal, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button, Card, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { RecoveryPhraseView } from '@/components/auth/RecoveryPhraseView'
import { useAuth } from '@/hooks/useAuth'
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

export default function Settings() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { lastPull, pending, syncing, message, syncNow } = useSyncStatus()
  const { needsSetup, phrase, busy, error, setup, done } = useRecoverySetup()
  const { logout } = useAuth()

  return (
    <Screen scroll>
      {phrase && (
        <Modal visible animationType="slide" onRequestClose={done}>
          <RecoveryPhraseView phrase={phrase} onConfirm={done} />
        </Modal>
      )}

      <Text variant="title">Settings</Text>

      <Text variant="label" color="textMuted" style={styles.section}>
        Sync
      </Text>
      <Card variant="sunken">
        <View style={styles.row}>
          <Text variant="body" color="textSecondary">
            Last synced
          </Text>
          <Text variant="bodyStrong">{timeAgo(lastPull)}</Text>
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
      <View style={styles.logout}>
        <Button title="Log out" variant="destructive" fullWidth onPress={() => logout()} testID="settings-logout" />
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    section: { marginTop: t.spacing['2xl'], marginBottom: t.spacing.sm, textTransform: 'uppercase' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: t.spacing.xs },
    action: { marginTop: t.spacing.md },
    syncMessage: { textAlign: 'center', marginTop: t.spacing.md },
    error: { marginTop: t.spacing.sm },
    hint: { marginTop: t.spacing.xs },
    logout: { marginTop: t.spacing.xl },
  })
