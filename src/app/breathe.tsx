import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { Button, Text } from '@/components/ui'
import { haptics } from '@/lib/haptics'
import { CYCLES, START_SCALE, stepAt, totalSteps } from '@/services/breathing/pattern'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

const CIRCLE = 220

/** A ~80-second box-breathing exercise. On-device only — animation + timer +
 * optional haptics. Reached manually from Settings. Non-clinical by design. */
export default function BreatheScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const reducedMotion = useReducedMotion()

  const [index, setIndex] = useState(0)
  const [running, setRunning] = useState(true)
  const [done, setDone] = useState(false)
  const [haptic, setHaptic] = useState(true)
  const scale = useSharedValue(START_SCALE)

  useEffect(() => {
    if (!running) return
    if (index >= totalSteps) {
      setDone(true)
      setRunning(false)
      return
    }
    const { step } = stepAt(index)
    if (haptic) haptics.light()
    if (reducedMotion) {
      scale.value = step.scale
    } else {
      scale.value = withTiming(step.scale, { duration: step.seconds * 1000 })
    }
    const t = setTimeout(() => setIndex((i) => i + 1), step.seconds * 1000)
    return () => clearTimeout(t)
  }, [index, running, haptic, reducedMotion, scale])

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  if (done) {
    return (
      <SafeAreaView style={styles.container} testID="breathe">
        <StatusBar style={theme.statusBar} />
        <View style={styles.center}>
          <Text variant="title" style={styles.centerText}>
            Nicely done.
          </Text>
          <Text variant="body" color="textSecondary" style={[styles.centerText, styles.doneSub]}>
            Notice how you feel now — no need to change anything.
          </Text>
        </View>
        <View style={styles.footer}>
          <Button title="Write about it" fullWidth onPress={() => router.replace('/entry')} testID="breathe-write" />
          <Pressable onPress={() => router.back()} testID="breathe-done" style={styles.doneLink}>
            <Text variant="label" color="textMuted">
              Done
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const { step, cycle } = stepAt(Math.min(index, totalSteps - 1))

  return (
    <SafeAreaView style={styles.container} testID="breathe">
      <StatusBar style={theme.statusBar} />

      <View style={styles.topBar}>
        <Pressable
          onPress={() => setHaptic((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={haptic ? 'Turn off vibration' : 'Turn on vibration'}
          testID="breathe-haptic"
        >
          <Ionicons name={haptic ? 'pulse' : 'pulse-outline'} size={22} color={theme.colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID="breathe-close"
        >
          <Ionicons name="close" size={26} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.center}>
        <View style={styles.circleWrap}>
          <Animated.View style={[styles.circle, circleStyle]} />
          <Text variant="title" color="accentText">
            {step.label}
          </Text>
        </View>
        <Text variant="caption" color="textMuted" style={styles.cycle}>
          Cycle {cycle} of {CYCLES}
        </Text>
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.bg },
    topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    centerText: { textAlign: 'center', paddingHorizontal: t.spacing['2xl'] },
    circleWrap: { width: CIRCLE, height: CIRCLE, alignItems: 'center', justifyContent: 'center' },
    circle: {
      position: 'absolute',
      width: CIRCLE,
      height: CIRCLE,
      borderRadius: CIRCLE / 2,
      backgroundColor: t.colors.accentMuted,
    },
    cycle: { marginTop: t.spacing['2xl'] },
    doneSub: { marginTop: t.spacing.md },
    footer: { paddingHorizontal: t.spacing['2xl'], paddingBottom: t.spacing.xl, gap: t.spacing.md },
    doneLink: { alignItems: 'center', paddingVertical: t.spacing.sm },
  })
