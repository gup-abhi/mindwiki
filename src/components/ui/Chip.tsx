import { Pressable, StyleSheet } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'

import { Text } from './Text'

interface ChipProps {
  label: string
  selected?: boolean
  onPress?: () => void
  disabled?: boolean
  testID?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      minHeight: 48,
      justifyContent: 'center',
      borderRadius: t.radii.pill,
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.lg,
      backgroundColor: t.colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    selected: { backgroundColor: t.colors.accentMuted, borderColor: t.colors.accent },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.85 },
  })

/** Pill — filter / selectable tag. */
export function Chip({ label, selected = false, onPress, disabled = false, testID }: ChipProps) {
  const styles = useThemedStyles(makeStyles)
  const handlePress = onPress
    ? () => {
        try { haptics.select() } catch { /* optional native feedback */ }
        onPress()
      }
    : undefined
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      style={({ pressed }) => [styles.base, selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text variant="label" color={selected ? 'accentText' : 'textPrimary'}>
        {label}
      </Text>
    </Pressable>
  )
}
