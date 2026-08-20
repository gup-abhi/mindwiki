import { type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'

import { type Theme, useThemedStyles } from '@/theme'

type CardVariant = 'surface' | 'accent' | 'sunken'

interface CardProps {
  children: ReactNode
  variant?: CardVariant
  onPress?: () => void
  style?: ViewStyle
  testID?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      borderRadius: t.radii.lg,
      padding: t.spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    surface: { backgroundColor: t.colors.surface },
    accent: { backgroundColor: t.colors.accentMuted },
    sunken: { backgroundColor: t.colors.surfaceSunken },
    pressed: { opacity: 0.9 },
  })

/** Soft, rounded surface with gentle elevation. Optionally pressable. */
export function Card({ children, variant = 'surface', onPress, style, testID }: CardProps) {
  const styles = useThemedStyles(makeStyles)
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        testID={testID}
        style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    )
  }
  return (
    <View testID={testID} style={[styles.base, styles[variant], style]}>
      {children}
    </View>
  )
}
