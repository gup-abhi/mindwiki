import { Pressable, StyleSheet } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'

import { Text } from './Text'

interface ChipProps {
  label: string
  selected?: boolean
  onPress?: () => void
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
export function Chip({ label, selected = false, onPress, testID }: ChipProps) {
  const styles = useThemedStyles(makeStyles)
  const handlePress = onPress
    ? () => {
        haptics.select()
        onPress()
      }
    : undefined
  return (
    <Pressable
      onPress={handlePress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      style={({ pressed }) => [styles.base, selected && styles.selected, pressed && styles.pressed]}
    >
      <Text variant="label" color={selected ? 'primaryText' : 'textPrimary'}>
        {label}
      </Text>
    </Pressable>
  )
}
