import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { Card, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { getFirstRunPageReady } from '@/services/onboarding/first-run'

type ReadyPage = { id: string; title: string }

/**
 * Deferred first-run aha moment (P1). When the deep model finishes synthesizing a
 * first-run's entries AFTER the funnel completed (the model was absent during the
 * path), the catch-up path records the first page via a one-shot settings marker.
 * This banner surfaces that page once on Home and deep-links to it. The marker is
 * one-shot (cleared on read), so the banner never re-fires. Renders nothing when
 * no first page is pending — self-gating like the other Home cards.
 */
export function FirstPageReadyBanner() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [page, setPage] = useState<ReadyPage | null>(null)

  // Checked on focus so the banner appears as soon as catch-up records the page,
  // even if the user has been sitting on Home since before synthesis finished.
  useFocusEffect(() => {
    let active = true
    void getFirstRunPageReady().then((p) => {
      if (active) setPage(p)
    })
    return () => {
      active = false
    }
  })

  if (!page) return null

  const view = () => {
    router.push({ pathname: `/wiki/${page.id}`, params: { firstRun: '1' } })
    setPage(null)
  }

  return (
    <Card variant="accent" style={styles.card} testID="first-page-ready-banner">
      <Pressable accessibilityRole="button" onPress={view} testID="first-page-ready-open">
        <Text variant="label" color="accentText">
          Your first insight page is ready
        </Text>
        <Text variant="body" color="accentText" style={styles.title}>
          {page.title}
        </Text>
        <Text variant="caption" color="accentText" style={styles.cta}>
          See what emerged from what you wrote →
        </Text>
      </Pressable>
      <View style={styles.dismissRow}>
        <Pressable
          hitSlop={8}
          accessibilityLabel="Dismiss"
          onPress={() => setPage(null)}
          testID="first-page-ready-dismiss"
        >
          <Ionicons name="close" size={18} color={theme.colors.accentText} />
        </Pressable>
      </View>
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { marginTop: t.spacing.lg, alignSelf: 'stretch' },
    title: { marginTop: t.spacing.xs },
    cta: { marginTop: t.spacing.sm },
    dismissRow: { position: 'absolute', top: t.spacing.sm, right: t.spacing.sm },
  })
