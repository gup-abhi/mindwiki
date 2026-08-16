import { Pressable, StyleSheet, type AccessibilityState } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { type ColorTokens, type Theme, useTheme, useThemedStyles } from '@/theme'

interface IconButtonProps {
  name: keyof typeof Ionicons.glyphMap
  onPress: () => void
  accessibilityLabel: string
  size?: number
  color?: keyof ColorTokens
  testID?: string
  accessibilityState?: AccessibilityState
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      padding: t.spacing.sm,
      borderRadius: t.radii.pill,
    },
    pressed: { opacity: 0.6 },
  })

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  size = 24,
  color = 'textSecondary',
  testID,
  accessibilityState,
}: IconButtonProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
      style={({ pressed }) => [styles.base, pressed && styles.pressed]}
    >
      <Ionicons name={name} size={size} color={theme.colors[color]} />
    </Pressable>
  )
}
