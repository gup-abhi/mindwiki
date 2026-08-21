import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { useEntryLifecycle } from '@/hooks/useEntryLifecycle'
import { Ionicons } from '@expo/vector-icons'

import { Button, Card, Screen, Text } from '@/components/ui'
import { ReflectionRoutineEditor } from '@/components/notifications/ReflectionRoutineEditor'
import { useNotifications } from '@/hooks/useNotifications'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
    badge: {
      width: 88,
      height: 88,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.accentMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing.sm,
    },
    subtitle: { textAlign: 'center', maxWidth: 300 },
    cta: { marginTop: t.spacing.xl, alignSelf: 'stretch', paddingHorizontal: t.spacing['2xl'], gap: t.spacing.md },
  })

export default function SavedScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  // On a low-mood day, gently offer a breather before sending them home.
  const { id, mood } = useLocalSearchParams<{ id?: string; mood?: string }>()
  const lowMood = Number(mood) > 0 && Number(mood) <= 2
  const { status, refresh } = useEntryLifecycle(id)
  const { preferences, busy, savePlan, allow, permission, openSystemSettings } = useNotifications()
  const showSetup = Boolean(id) && !preferences.setupDismissed && preferences.firstPlanSavedAt == null
  const [showConsent, setShowConsent] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  return (
    <Screen>
      <View style={styles.center}>
        <View style={styles.badge}>
          <Ionicons name="checkmark" size={44} color={theme.colors.success} />
        </View>
        <Text variant="title">Saved privately</Text>
        <Text variant="body" color="textSecondary" style={styles.subtitle}>
          Your reflection is encrypted on this device. You can leave now while private synthesis continues.
        </Text>
        {status === 'pending' && <Text variant="label" color="accent">Private synthesis</Text>}
        {status === 'ready' && <Text variant="label" color="accent">Insight ready</Text>}
        {status === 'unavailable' && <Text variant="caption" color="textMuted">Private synthesis is not available yet.</Text>}
        {status === 'retryable' && (
          <Button title="Check again" variant="ghost" onPress={refresh} testID="saved-retry" />
        )}
        {showSetup && !showConsent && !showEditor && (
          <Card variant="sunken" testID="saved-notification-setup">
            <Text variant="bodyStrong">Make reflection a routine</Text>
            <Text variant="caption" color="textSecondary" style={styles.subtitle}>
              Choose days and a time for a private, generic reminder. You can change or pause it anytime.
            </Text>
            <View style={styles.cta}>
              <Button title="Set a routine" fullWidth onPress={() => setShowEditor(true)} testID="saved-notification-set" />
              <Button title="Not now" variant="ghost" fullWidth onPress={() => void savePlan({ setupDismissed: true, enabled: false })} testID="saved-notification-not-now" />
            </View>
          </Card>
        )}
        {showSetup && showEditor && !showConsent && (
          <ReflectionRoutineEditor
            preferences={preferences}
            busy={busy}
            onCancel={() => setShowEditor(false)}
            onSave={(patch) => void savePlan(patch).then((result) => {
              if (result.success) {
                setShowEditor(false)
                setShowConsent(true)
              }
            })}
            testID="saved-notification-editor"
          />
        )}
        {showConsent && (
          <Card variant="sunken" testID="saved-notification-consent">
            <Text variant="bodyStrong">Your plan is saved on this device</Text>
            <Text variant="caption" color="textSecondary" style={styles.subtitle}>
              Notifications use generic copy. The main tap opens Journal, with Reflect as an optional action. No journal text enters the notification.
            </Text>
            <View style={styles.cta}>
              <Button title="Allow notifications" loading={busy} fullWidth onPress={() => void allow()} testID="saved-notification-allow" />
              <Button title="Not now" variant="ghost" fullWidth onPress={() => setShowConsent(false)} testID="saved-notification-consent-not-now" />
              {(permission === 'denied' || permission === 'blocked') && <Button title="Open system settings" variant="secondary" fullWidth onPress={() => void openSystemSettings()} />}
            </View>
          </Card>
        )}
        {id && (
          <Button
            title="View saved entry"
            variant="secondary"
            fullWidth
            onPress={() => router.replace(`/entries/${id}`)}
            testID="saved-view-entry"
          />
        )}
        <View style={styles.cta}>
          {lowMood && (
            <Button
              title="Take a minute to breathe"
              variant="secondary"
              fullWidth
              onPress={() => router.replace('/breathe')}
              testID="saved-breathe"
            />
          )}
          <Button title="Done" fullWidth onPress={() => router.replace('/')} />
        </View>
      </View>
    </Screen>
  )
}
