import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'

import { Text } from './Text'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps {
  title: string
  onPress: () => void
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  haptic?: boolean
  icon?: keyof typeof Ionicons.glyphMap
  fullWidth?: boolean
  testID?: string
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.spacing.sm,
      borderRadius: t.radii.md,
    },
    sm: { paddingVertical: t.spacing.sm, paddingHorizontal: t.spacing.lg },
    md: { paddingVertical: t.spacing.md + 2, paddingHorizontal: t.spacing.xl },
    lg: { paddingVertical: t.spacing.lg, paddingHorizontal: t.spacing.xl },
    primary: { backgroundColor: t.colors.primary },
    secondary: { backgroundColor: t.colors.surfaceAlt },
    ghost: { backgroundColor: 'transparent' },
    destructive: { backgroundColor: t.colors.danger },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.85 },
    fullWidth: { alignSelf: 'stretch' },
  })

const textColorFor: Record<Variant, 'primaryText' | 'textPrimary' | 'accent' | 'dangerText'> = {
  primary: 'primaryText',
  secondary: 'textPrimary',
  ghost: 'accent',
  destructive: 'dangerText',
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  haptic = true,
  icon,
  fullWidth = false,
  testID,
}: ButtonProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const isDisabled = disabled || loading
  const tint = theme.colors[textColorFor[variant]]

  const handlePress = () => {
    if (haptic) haptics.light()
    onPress()
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }): ViewStyle[] => [
        styles.base,
        styles[size],
        styles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ].filter(Boolean) as ViewStyle[]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <View style={styles.base}>
          {icon ? <Ionicons name={icon} size={18} color={tint} /> : null}
          <Text variant="button" color={textColorFor[variant]}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  )
}
