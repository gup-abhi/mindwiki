import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { haptics } from '@/lib/haptics'

import { type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'

import { Button, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type NotificationPreferences } from '@/services/notifications/types'

interface ReflectionRoutineEditorProps {
  preferences: NotificationPreferences
  busy?: boolean
  disabled?: boolean
  onSave: (patch: Pick<NotificationPreferences, 'routineWeekdays' | 'routineHour' | 'retryDelayMinutes'>) => void
  onCancel: () => void
  testID?: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 18 }, (_, index) => index + 6)
const RETRIES = [30, 60, 120] as const

const makeStyles = (t: Theme) => StyleSheet.create({
  content: { alignSelf: 'stretch', gap: t.spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, paddingHorizontal: t.spacing.sm },
  weekday: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.sm,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceAlt,
  },
  weekdaySelected: { backgroundColor: t.colors.accentMuted, borderColor: t.colors.accent },
  wheel: { height: 144, marginTop: t.spacing.sm },
  wheelContent: { paddingVertical: 48 },
  wheelItem: { height: 48, alignItems: 'center', justifyContent: 'center' },
  actions: { marginTop: t.spacing.sm, gap: t.spacing.sm },
})

function formatHour(hour: number): string {
  return new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

type WheelPickerProps = {
  values: readonly number[]
  selectedValue: number
  formatValue: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
  testID?: string
}

function WheelPicker({ values, selectedValue, formatValue, onChange, disabled = false, testID }: WheelPickerProps) {
  const styles = useThemedStyles(makeStyles)
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    const index = values.indexOf(selectedValue)
    if (index >= 0) scrollRef.current?.scrollTo({ y: index * 48, animated: false })
  }, [selectedValue, values])

  const selectFromScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / 48)))
    onChange(values[index])
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.wheel}
      contentContainerStyle={styles.wheelContent}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled={!disabled}
      directionalLockEnabled
      scrollEnabled={!disabled}
      snapToInterval={48}
      scrollEventThrottle={16}
      decelerationRate="fast"
      onMomentumScrollEnd={selectFromScroll}
      onScrollEndDrag={selectFromScroll}
      testID={testID}
    >
      {values.map((value, index) => (
        <Pressable
          key={value}
          style={styles.wheelItem}
          disabled={disabled}
          onPress={() => {
            onChange(value)
            scrollRef.current?.scrollTo({ y: index * 48, animated: true })
          }}
          testID={testID ? `${testID}-${value}` : undefined}
          accessibilityRole="button"
          accessibilityState={{ selected: value === selectedValue }}
        >
          <Text variant={value === selectedValue ? 'bodyStrong' : 'body'} color={value === selectedValue ? 'textPrimary' : 'textMuted'}>
            {formatValue(value)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

export function ReflectionRoutineEditor({ preferences, busy = false, disabled = false, onSave, onCancel, testID }: ReflectionRoutineEditorProps) {
  const styles = useThemedStyles(makeStyles)
  const [days, setDays] = useState(() => new Set(preferences.routineWeekdays ?? []))
  const [hour, setHour] = useState(preferences.routineHour ?? 20)
  const [retryDelayMinutes, setRetryDelayMinutes] = useState<30 | 60 | 120>(preferences.retryDelayMinutes ?? 60)

  useEffect(() => {
    setDays(new Set(preferences.routineWeekdays ?? []))
    setHour(preferences.routineHour ?? 20)
    setRetryDelayMinutes(preferences.retryDelayMinutes ?? 60)
  }, [preferences.retryDelayMinutes, preferences.routineHour, preferences.routineWeekdays])

  return (
    <View testID={testID} style={styles.content}>
      <Text variant="bodyStrong">Choose your routine</Text>
      <Text variant="caption" color="textSecondary">Pick at least one day, one time, and one gentle same-day retry.</Text>
      <Text variant="caption" color="textSecondary">Days</Text>
      <View style={styles.choices}>
        {DAYS.map((label, day) => {
          const selected = days.has(day)
          return (
            <Pressable
              key={label}
              style={({ pressed }) => [styles.weekday, selected && styles.weekdaySelected, pressed && { opacity: 0.85 }]}
              disabled={disabled}
              onPress={() => {
                try { haptics.select() } catch { /* optional native feedback */ }
                setDays((current) => {
                  const next = new Set(current)
                  if (next.has(day)) next.delete(day)
                  else next.add(day)
                  return next
                })
              }}
              accessibilityRole="checkbox"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              testID={`${testID}-day-${day}`}
            >
              <Text variant="label" color={selected ? 'accentText' : 'textPrimary'}>{label.charAt(0)}</Text>
            </Pressable>
          )
        })}
      </View>
      <Text variant="caption" color="textSecondary">Preferred time</Text>
      <WheelPicker
        values={HOURS}
        selectedValue={hour}
        formatValue={formatHour}
        onChange={setHour}
        disabled={disabled}
        testID={`${testID}-hour-picker`}
      />
      <Text variant="caption" color="textSecondary">Same-day retry</Text>
      <WheelPicker
        values={RETRIES}
        selectedValue={retryDelayMinutes}
        formatValue={(value) => `${value} min`}
        onChange={(value) => setRetryDelayMinutes(value as 30 | 60 | 120)}
        disabled={disabled}
        testID={`${testID}-retry-picker`}
      />
      <View style={styles.actions}>
        <Button
          title="Save routine"
          fullWidth
          loading={busy}
          disabled={disabled || days.size === 0}
          onPress={() => onSave({ routineWeekdays: [...days].sort((a, b) => a - b), routineHour: hour, retryDelayMinutes })}
          testID={`${testID}-save`}
        />
        <Button title="Cancel" variant="ghost" fullWidth disabled={disabled} onPress={onCancel} testID={`${testID}-cancel`} />
      </View>
    </View>
  )
}
