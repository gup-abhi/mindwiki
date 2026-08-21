import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Button, Card, Chip, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type NotificationPreferences } from '@/services/notifications/types'

interface ReflectionRoutineEditorProps {
  preferences: NotificationPreferences
  busy?: boolean
  onSave: (patch: Pick<NotificationPreferences, 'routineWeekdays' | 'routineHour' | 'retryDelayMinutes'>) => void
  onCancel: () => void
  testID?: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 18 }, (_, index) => index + 6)
const RETRIES = [30, 60, 120] as const

const makeStyles = (t: Theme) => StyleSheet.create({
  card: { alignSelf: 'stretch', gap: t.spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  actions: { marginTop: t.spacing.sm, gap: t.spacing.sm },
})

function formatHour(hour: number): string {
  return new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

export function ReflectionRoutineEditor({ preferences, busy = false, onSave, onCancel, testID }: ReflectionRoutineEditorProps) {
  const styles = useThemedStyles(makeStyles)
  const [days, setDays] = useState(() => new Set(preferences.routineWeekdays ?? []))
  const [hour, setHour] = useState(preferences.routineHour ?? 20)
  const [retryDelayMinutes, setRetryDelayMinutes] = useState<30 | 60 | 120>(preferences.retryDelayMinutes ?? 60)

  return (
    <Card variant="sunken" testID={testID} style={styles.card}>
      <Text variant="bodyStrong">Choose your routine</Text>
      <Text variant="caption" color="textSecondary">Pick at least one day, one time, and one gentle same-day retry.</Text>
      <Text variant="caption" color="textSecondary">Days</Text>
      <View style={styles.choices}>
        {DAYS.map((label, day) => (
          <Chip
            key={label}
            label={label}
            selected={days.has(day)}
            onPress={() => setDays((current) => {
              const next = new Set(current)
              if (next.has(day)) next.delete(day)
              else next.add(day)
              return next
            })}
            testID={`${testID}-day-${day}`}
          />
        ))}
      </View>
      <Text variant="caption" color="textSecondary">Preferred time</Text>
      <View style={styles.choices}>
        {HOURS.map((value) => (
          <Chip key={value} label={formatHour(value)} selected={hour === value} onPress={() => setHour(value)} testID={`${testID}-hour-${value}`} />
        ))}
      </View>
      <Text variant="caption" color="textSecondary">Same-day retry</Text>
      <View style={styles.choices}>
        {RETRIES.map((value) => (
          <Chip key={value} label={`${value} min`} selected={retryDelayMinutes === value} onPress={() => setRetryDelayMinutes(value)} testID={`${testID}-retry-${value}`} />
        ))}
      </View>
      <View style={styles.actions}>
        <Button
          title="Save routine"
          fullWidth
          loading={busy}
          disabled={days.size === 0}
          onPress={() => onSave({ routineWeekdays: [...days].sort((a, b) => a - b), routineHour: hour, retryDelayMinutes })}
          testID={`${testID}-save`}
        />
        <Button title="Cancel" variant="ghost" fullWidth onPress={onCancel} testID={`${testID}-cancel`} />
      </View>
    </Card>
  )
}
