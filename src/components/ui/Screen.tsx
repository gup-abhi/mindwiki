import { type ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

import { useReducedMotion } from '@/hooks/useReducedMotion'
import { type Theme, useThemedStyles, useTheme } from '@/theme'

interface ScreenProps {
  children: ReactNode
  /** Wrap content in a ScrollView. */
  scroll?: boolean
  /** Apply default horizontal+top padding. */
  padded?: boolean
  /**
   * Fade the content in on mount (default true). Turn OFF for screens with text
   * inputs: a reanimated `entering` animation mismeasures touch targets on
   * Android/Fabric, leaving inputs only partially tappable.
   */
  animated?: boolean
  edges?: readonly Edge[]
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.colors.bg },
    padded: { paddingHorizontal: t.spacing.xl },
    scrollContent: { paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing['2xl'] },
    flex: { flex: 1 },
  })

/** Themed screen wrapper: safe-area, background, and a status bar matching the theme. */
export function Screen({
  children,
  scroll,
  padded = true,
  animated = true,
  edges = ['top', 'left', 'right'],
}: ScreenProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const reducedMotion = useReducedMotion()
  const showAnimation = animated && !reducedMotion
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <StatusBar style={theme.statusBar} />
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={padded ? styles.scrollContent : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {showAnimation ? (
            <Animated.View entering={FadeIn.duration(250)}>{children}</Animated.View>
          ) : (
            children
          )}
        </ScrollView>
      ) : showAnimation ? (
        <Animated.View style={[styles.flex, padded && styles.padded]} entering={FadeIn.duration(250)}>
          {children}
        </Animated.View>
      ) : (
        <View style={[styles.flex, padded && styles.padded]}>{children}</View>
      )}
    </SafeAreaView>
  )
}
