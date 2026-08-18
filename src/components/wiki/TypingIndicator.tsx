import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { useReducedMotion } from '@/hooks/useReducedMotion'
import { type Theme, useThemedStyles } from '@/theme'

function TypingDot({ delay, reducedMotion }: { delay: number; reducedMotion: boolean }) {
  const opacity = useSharedValue(reducedMotion ? 0.65 : 0.35)

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(opacity)
      opacity.value = 0.65
      return
    }
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320 }),
          withTiming(0.35, { duration: 320 })
        ),
        -1
      )
    )
    return () => cancelAnimation(opacity)
  }, [delay, opacity, reducedMotion])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const styles = useThemedStyles(makeStyles)
  return <Animated.View style={[styles.dot, animatedStyle]} testID="typing-dot" />
}

/** A truthful pending-reply state; decorative dots are hidden from accessibility. */
export function TypingIndicator() {
  const styles = useThemedStyles(makeStyles)
  const reducedMotion = useReducedMotion()

  return (
    <View style={styles.wrap}>
      <View
        style={styles.bubble}
        accessible
        accessibilityLabel="Assistant is replying"
        accessibilityLiveRegion="polite"
        accessibilityState={{ busy: true }}
        testID="typing-indicator"
      >
        <View
          style={styles.dots}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <TypingDot delay={0} reducedMotion={reducedMotion} />
          <TypingDot delay={160} reducedMotion={reducedMotion} />
          <TypingDot delay={320} reducedMotion={reducedMotion} />
        </View>
      </View>
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { alignItems: 'flex-start', marginBottom: t.spacing.md },
    bubble: {
      paddingVertical: t.spacing.md,
      paddingHorizontal: t.spacing.lg,
      borderRadius: t.radii.lg,
      backgroundColor: t.colors.surfaceAlt,
    },
    dots: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: t.colors.textMuted,
    },
  })
