import { Pressable, StyleSheet, View } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'

import { Text } from './Text'

type ChipMode = 'action' | 'single' | 'multi' | 'toggle'

interface ChipProps {
  label: string
  selected?: boolean
  onPress?: () => void
  mode?: ChipMode
  testID?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      borderRadius: t.radii.pill,
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.lg,
      backgroundColor: t.colors.surfaceAlt,
    },
    selected: { backgroundColor: t.colors.accent },
    pressed: { opacity: 0.85 },
  })

/** Pill — filter / selectable tag. */
export function Chip({ label, selected = false, onPress, mode = 'multi', testID }: ChipProps) {
  const styles = useThemedStyles(makeStyles)
  const handlePress = onPress
    ? () => {
        try { haptics.select() } catch { /* optional native feedback */ }
        onPress()
      }
    : undefined
  const accessibilityRole = onPress
    ? mode === 'action'
      ? 'button'
      : mode === 'single'
        ? 'radio'
        : mode === 'toggle'
          ? 'switch'
          : 'checkbox'
    : undefined
  const accessibilityState = onPress
    ? mode === 'single'
      ? { selected }
      : mode === 'toggle'
        ? { checked: selected }
        : mode === 'multi'
          ? { checked: selected }
          : undefined
    : undefined

  const content = (
    <Text variant="label" color={selected ? 'primaryText' : 'textPrimary'}>
      {label}
    </Text>
  )

  if (!onPress) {
    return (
      <View style={[styles.base, selected && styles.selected]} testID={testID}>
        {content}
      </View>
    )
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      testID={testID}
      style={({ pressed }) => [styles.base, selected && styles.selected, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  )
}
