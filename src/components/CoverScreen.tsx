import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { getCoverAffirmation } from '@/services/challenges/cover'

// Shown once per app launch (a fresh JS context resets this). A lock/unlock
// later in the same session won't replay it.
let coverShownThisLaunch = false

/**
 * A colourful full-screen flash of the user's earned affirmation, shown over the
 * app on launch (after unlock, so it reads from the open encrypted DB) and then
 * fading away to reveal Home. Renders nothing when no affirmation is set — which
 * is the common case, since one is only earned by finishing a challenge.
 */
export function CoverScreen() {
  const styles = useThemedStyles(makeStyles)
  const [affirmation, setAffirmation] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const opacity = useSharedValue(0)

  useEffect(() => {
    if (coverShownThisLaunch) {
      setDone(true)
      return
    }
    let active = true
    void getCoverAffirmation().then((a) => {
      if (!active) return
      if (!a) {
        setDone(true)
        return
      }
      coverShownThisLaunch = true
      setAffirmation(a)
    })
    return () => {
      active = false
    }
  }, [])

  const dismiss = () => {
    opacity.value = withTiming(0, { duration: 350 }, (finished) => {
      if (finished) runOnJS(setDone)(true)
    })
  }

  // Fade in once the affirmation is loaded, then stay put until the user taps.
  useEffect(() => {
    if (affirmation == null) return
    opacity.value = withTiming(1, { duration: 600 })
  }, [affirmation, opacity])

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  if (done || affirmation == null) return null

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
