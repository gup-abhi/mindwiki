import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useRouter } from 'expo-router'

import { Button, Card, Chip, IconButton, Screen, Text } from '@/components/ui'
import { ReflectionRoutineEditor } from '@/components/notifications/ReflectionRoutineEditor'
import { useNotifications } from '@/hooks/useNotifications'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { type Theme, useThemedStyles } from '@/theme'

function formatResumeDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function pauseUntil(days: number): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

function pauseLabel(timestamp: number | null): string | null {
  if (timestamp == null || timestamp <= Date.now()) return null
  return `Paused until ${formatResumeDate(timestamp)}`
}

function ReminderToggle({ value, disabled, onChange }: { value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  const styles = useThemedStyles(makeStyles)
  const reducedMotion = useReducedMotion()
  const progress = useSharedValue(value ? 1 : 0)

  useEffect(() => {
    progress.value = reducedMotion ? (value ? 1 : 0) : withTiming(value ? 1 : 0, { duration: 220 })
  }, [progress, reducedMotion, value])

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [styles.toggleOff.backgroundColor, styles.toggleOn.backgroundColor]),
  }))
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 24 }],
  }))

  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel="Private reminders"
      accessibilityState={{ checked: value, disabled }}
      testID="notification-settings-toggle"
      style={styles.toggleHit}
    >
      <Animated.View style={[styles.toggleTrack, trackStyle]}>
        <Animated.View style={[styles.toggleThumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  )
}

export default function NotificationSettings() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const [status, setStatus] = useState<string | null>(null)
  const {
    preferences,
    permission,
    busy,
    update,
    savePlan,
    openSystemSettings,
  } = useNotifications()

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton name="chevron-back" color="accent" onPress={() => router.back()} accessibilityLabel="Back" testID="notification-settings-back" />
        <Text accessibilityRole="header" variant="title">Notification settings</Text>
      </View>

      <Text variant="body" color="textSecondary" style={styles.intro}>
        Choose one quiet routine for this device. Reminders use generic copy and never include journal or Reflect content.
      </Text>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Notifications
      </Text>
      <Card variant="sunken">
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text variant="bodyStrong">Private reminders</Text>
            <Text variant="caption" color="textSecondary">Journal is the main action. Reflect is available as an alternative.</Text>
          </View>
          <ReminderToggle
            value={preferences.enabled}
            disabled={busy}
            onChange={(enabled) => {
              if (enabled) void savePlan({ enabled: true })
              else void update({ enabled: false })
            }}
          />
        </View>
        <Text variant="caption" color="textMuted" style={styles.hint}>Permission: {permission}</Text>
        {(permission === 'blocked' || permission === 'denied') && (
          <View style={styles.action}>
            <Button title="Open system notification settings" variant="secondary" fullWidth disabled={!preferences.enabled} onPress={() => void openSystemSettings()} testID="notification-settings-system" />
          </View>
        )}
      </Card>

      <Text accessibilityRole="header" variant="label" color="textMuted" style={styles.section}>
        Reflection routine
      </Text>
      <Card variant="sunken">
        <ReflectionRoutineEditor
          preferences={preferences}
          disabled={!preferences.enabled}
          busy={busy}
          onSave={(patch) => {
            setStatus(null)
            void savePlan(patch).then((result) => {
              setStatus(result.success ? 'Routine saved on this device.' : result.error.message)
            })
          }}
          onCancel={() => router.back()}
          testID="notification-settings-editor"
        />
        {status && (
          <Text
            variant="caption"
            color={status.endsWith('.') && status.startsWith('Routine saved') ? 'success' : 'danger'}
            style={styles.hint}
            testID="notification-settings-status"
            accessibilityLiveRegion="polite"
          >
            {status}
          </Text>
        )}
        {!preferences.enabled && (
          <Text variant="caption" color="textSecondary" style={styles.hint}>
            Set a routine when you want a gentle prompt to write or reflect.
          </Text>
        )}
        {preferences.enabled && (
          <View style={styles.action}>
            {pauseLabel(preferences.pausedUntil) ? (
              <>
                <Text variant="caption" color="textSecondary" style={styles.hint}>{pauseLabel(preferences.pausedUntil)}</Text>
                <Button title="Resume now" variant="secondary" fullWidth loading={busy} onPress={() => void update({ pausedUntil: null })} testID="notification-settings-resume" />
              </>
            ) : (
              <>
                <Text variant="caption" color="textSecondary" style={styles.hint}>Pause reminders</Text>
                <View style={styles.choices}>
                  <Chip label="Tomorrow" disabled={!preferences.enabled} onPress={() => void update({ pausedUntil: pauseUntil(1) })} testID="notification-settings-pause-tomorrow" />
                  <Chip label="One week" disabled={!preferences.enabled} onPress={() => void update({ pausedUntil: pauseUntil(7) })} testID="notification-settings-pause-week" />
                  <Chip label="Two weeks" disabled={!preferences.enabled} onPress={() => void update({ pausedUntil: pauseUntil(14) })} testID="notification-settings-pause-two-weeks" />
                </View>
              </>
            )}
          </View>
        )}

        <View style={styles.extras}>
        <Text variant="bodyStrong">Optional extras</Text>
        <Text variant="caption" color="textSecondary">Additional gentle prompts, separate from your main routine.</Text>
        <View style={styles.choices}>
          <Chip label="Challenge" selected={preferences.challenge} disabled={!preferences.enabled} onPress={() => void update({ challenge: !preferences.challenge })} testID="notification-settings-challenge" />
          <Chip label="New insight" selected={preferences.insights} disabled={!preferences.enabled} onPress={() => void update({ insights: !preferences.insights })} testID="notification-settings-insights" />
          <Chip label="Weekly review" selected={preferences.weeklyReview === true} disabled={!preferences.enabled} onPress={() => void update({ weeklyReview: !preferences.weeklyReview })} testID="notification-settings-weekly" />
        </View>
      </View>
      </Card>
    </Screen>
  )
}

const makeStyles = (t: Theme) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  intro: { marginTop: t.spacing.md },
  section: { marginTop: t.spacing['2xl'], marginBottom: t.spacing.sm, textTransform: 'uppercase' },
  row: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.md },
  copy: { flex: 1 },
  hint: { marginTop: t.spacing.xs },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: t.spacing.sm },
  action: { marginTop: t.spacing.lg },
  extras: { marginTop: t.spacing.xl, paddingTop: t.spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border },
  toggleHit: { width: 56, height: 40, justifyContent: 'center' },
  toggleTrack: { width: 48, height: 28, borderRadius: 14, padding: 2, justifyContent: 'center', backgroundColor: t.colors.surfaceAlt },
  toggleOff: { backgroundColor: t.colors.surfaceAlt },
  toggleOn: { backgroundColor: t.colors.accent },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.colors.surface },
})
