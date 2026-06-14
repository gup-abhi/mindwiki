import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'

interface Props {
  affirmation: string
  /** Called after the fade-out completes when the user taps. */
  onDismiss: () => void
}

/**
 * The colourful full-screen affirmation card: a celebratory wash of colour with
 * the earned line centred. Fades in, holds until the user taps, then fades out.
 * Purely presentational — the launch flash and the reward replay both reuse it.
 */
export function AffirmationCover({ affirmation, onDismiss }: Props) {
  const styles = useThemedStyles(makeStyles)
  const opacity = useSharedValue(0)

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 600 })
  }, [opacity])

  const dismiss = () => {
    opacity.value = withTiming(0, { duration: 350 }, (finished) => {
      if (finished) runOnJS(onDismiss)()
    })
  }

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View style={[styles.fill, animStyle]}>
      <Pressable style={styles.fill} onPress={dismiss} accessibilityRole="button">
        <View style={[styles.blob, styles.blobTL]} />
        <View style={[styles.blob, styles.blobTR]} />
        <View style={[styles.blob, styles.blobBL]} />
        <View style={[styles.blob, styles.blobBR]} />
        <View style={styles.content}>
          <Text variant="label" style={styles.eyebrow}>
            YOU EARNED THIS
          </Text>
          <Text variant="display" style={styles.affirmation} testID="cover-affirmation">
            {affirmation}
          </Text>
          <Text variant="caption" style={styles.tap}>
            tap to continue
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    fill: { ...StyleSheet.absoluteFillObject, zIndex: 100, backgroundColor: t.colors.primary },
    // Soft colour blobs bleeding in from the corners for a celebratory wash.
    blob: { position: 'absolute', width: 360, height: 360, borderRadius: 180, opacity: 0.55 },
    blobTL: { top: -120, left: -110, backgroundColor: t.colors.graphPerson },
    blobTR: { top: -90, right: -130, backgroundColor: t.colors.graphSituation },
    blobBL: { bottom: -110, left: -120, backgroundColor: t.colors.graphBehavior },
    blobBR: { bottom: -130, right: -100, backgroundColor: t.colors.graphDistortion },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.spacing['2xl'] },
    eyebrow: { color: '#FFFFFF', opacity: 0.8, letterSpacing: 2, marginBottom: t.spacing.lg },
    affirmation: { color: '#FFFFFF', textAlign: 'center' },
    tap: { color: '#FFFFFF', opacity: 0.7, marginTop: t.spacing['2xl'] },
  })
