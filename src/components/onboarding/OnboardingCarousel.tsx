import { useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

import { Button, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

interface Slide {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  body: string
}

// The whole-app tour, in the app's own voice. Pillars in order: the wiki is the
// product, gentle CBT writing, growing insights, the Reflect companion, patterns,
// privacy.
const SLIDES: readonly Slide[] = [
  {
    icon: 'sparkles-outline',
    title: 'A journal that thinks with you',
    body: 'Every entry quietly builds your living Insight pages — so you never have to re-read old notes to find the thread.',
  },
  {
    icon: 'create-outline',
    title: 'Write the way therapists do',
    body: 'A gentle prompt walks you through mood, situation and thought. Short on time? Just log a mood.',
  },
  {
    icon: 'library-outline',
    title: 'Insights that grow',
    body: 'Your entries synthesise into pages about the people, feelings and patterns that shape your days.',
  },
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Talk it through',
    body: "Reflect is a companion that knows your patterns — not the internet's. The more you write, the better it understands you.",
  },
  {
    icon: 'stats-chart-outline',
    title: 'See the patterns',
    body: 'Mood trends, a weekly digest, and a Connections view of how they relate.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Yours alone',
    body: 'Everything is encrypted on this device. Only you hold the key — not even we can read your journal.',
  },
]

interface OnboardingCarouselProps {
  onDone: () => void
  onSignIn?: () => void
}

/** One-time full-screen welcome tour shown before account registration. */
export function OnboardingCarousel({ onDone, onSignIn }: OnboardingCarouselProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const listRef = useRef<FlatList<Slide>>(null)
  const [index, setIndex] = useState(0)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const isLast = index === SLIDES.length - 1
  const isAccountEntry = onSignIn !== undefined

  const goNext = () => {
    if (isLast) return onDone()
    const next = index + 1
    setIndex(next)
    listRef.current?.scrollToIndex({ index: next, animated: true })
  }

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
    // Reset inline confirm when the user swipes (they chose to keep looking).
    setConfirmSkip(false)
  }

  return (
    <SafeAreaView style={styles.container} testID="onboarding">
      <StatusBar style={theme.statusBar} />

      <View style={styles.skipRow}>
        {confirmSkip ? (
          <View style={styles.confirmRow}>
            <Text variant="caption" color="textMuted" style={styles.confirmCopy}>
              {isAccountEntry ? 'You can choose later whether to download private on-device AI.' : 'Close the introduction?'}
            </Text>
            <Pressable onPress={() => { setConfirmSkip(false) }} hitSlop={8} testID="onboarding-skip-cancel">
              <Text variant="label" color="textMuted">
                Cancel
              </Text>
            </Pressable>
            <Pressable onPress={onDone} hitSlop={8} testID="onboarding-skip-confirm">
              <Text variant="label" color="accent">
                Continue
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.topActions}>
            {onSignIn && (
              <Pressable onPress={onSignIn} hitSlop={8} testID="onboarding-sign-in">
                <Text variant="label" color="accent">
                  Sign in
                </Text>
              </Pressable>
            )}
            {!isLast && (
              <Pressable onPress={() => setConfirmSkip(true)} hitSlop={8} testID="onboarding-skip">
                <Text variant="label" color="textMuted">
                  Skip
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={styles.iconCircle}>
              <Ionicons name={item.icon} size={56} color={theme.colors.accent} />
            </View>
            <Text variant="title" style={styles.title}>
              {item.title}
            </Text>
            <Text variant="body" color="textSecondary" style={styles.body}>
              {item.body}
            </Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        {isLast && isAccountEntry && (
          <Text variant="caption" color="textMuted" style={styles.consent}>
            Your account keeps encrypted sync available. On-device AI is optional and can be downloaded later; journal writing works without it.
          </Text>
        )}
        <Button
          title={isLast ? (isAccountEntry ? 'Create your account' : 'Done') : 'Next'}
          onPress={goNext}
          fullWidth
          testID="onboarding-next"
        />
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.bg },
    skipRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md, minHeight: 28 },
    topActions: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xl },
    confirmRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, flex: 1, justifyContent: 'flex-end' },
    confirmCopy: { flex: 1 },
    slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.spacing['2xl'] },
    iconCircle: {
      width: 112,
      height: 112,
      borderRadius: 56,
      backgroundColor: t.colors.accentMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing['2xl'],
    },
    title: { textAlign: 'center' },
    body: { textAlign: 'center', marginTop: t.spacing.lg, lineHeight: 24 },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: t.spacing.sm, marginBottom: t.spacing.lg },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.divider },
    dotActive: { backgroundColor: t.colors.accent, width: 20 },
    footer: { paddingHorizontal: t.spacing['2xl'], paddingBottom: t.spacing.xl },
    consent: { textAlign: 'center', marginBottom: t.spacing.md, lineHeight: 18 },
  })
