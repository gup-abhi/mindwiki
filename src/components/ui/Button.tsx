import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'

import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { haptics } from '@/lib/haptics'

import { Text } from './Text'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

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
    sm: { minHeight: 48, paddingVertical: t.spacing.sm, paddingHorizontal: t.spacing.lg },
    md: { paddingVertical: t.spacing.md + 2, paddingHorizontal: t.spacing.xl },
    lg: { paddingVertical: t.spacing.lg, paddingHorizontal: t.spacing.xl },
    primary: { backgroundColor: t.colors.primary },
    secondary: { backgroundColor: t.colors.surfaceAlt },
    ghost: { backgroundColor: 'transparent' },
    destructive: { backgroundColor: t.colors.danger },
    disabled: { opacity: 0.45 },
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
  const reducedMotion = useReducedMotion()
  const isDisabled = disabled || loading
  const tint = theme.colors[textColorFor[variant]]

  // Calm press-scale: a small dip on press-in, springs back on release.
  const scale = useSharedValue(1)
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  const handlePress = () => {
    if (haptic) haptics.light()
    onPress()
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => {
        if (!reducedMotion && !isDisabled) scale.value = withTiming(0.97, { duration: 90 })
      }}
      onPressOut={() => {
        if (!reducedMotion) scale.value = withTiming(1, { duration: 120 })
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      testID={testID}
      // NOTE: an Animated (reanimated) component must take a static/array style —
      // a function style ({ pressed }) => … is NOT applied, which silently drops
      // the background/padding. Press feedback comes from the scale animation.
      style={[
        styles.base,
        styles[size],
        styles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        animStyle,
      ]}
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
    </AnimatedPressable>
  )
}
