import React from 'react'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useTrendingPages } from '@/hooks/useWiki'

const MAX_MOVERS = 4

/**
 * A glanceable "what's shifting" strip for Home — the top concepts whose
 * frequency is rising or falling, each tapping through to its page. A compact
 * discovery surface for the per-page trends (the full sparkline+sentence detail
 * lives on Trends). Renders nothing until there's something moving. Arrows show
 * direction only (coming up more/less), never a good/bad verdict.
 */
export function MoversStrip() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const movers = useTrendingPages()
    .filter((m) => m.trend.frequencyDirection !== 'steady')
    .slice(0, MAX_MOVERS)

  if (movers.length === 0) return null

  return (
    <Card variant="sunken" style={styles.card} testID="home-movers">
      <Text variant="caption" color="accent">
        What’s shifting
      </Text>
      <View style={styles.row}>
        {movers.map(({ page, trend }) => (
          <Pressable
            key={page.id}
            accessibilityRole="button"
            accessibilityLabel={`Open the ${page.title} page`}
            onPress={() => router.push(`/wiki/${page.id}`)}
            style={styles.chip}
            testID="home-mover"
          >
            <Text variant="body">
              {page.title} {trend.frequencyDirection === 'rising' ? '↑' : '↓'}
            </Text>
          </Pressable>
        ))}
      </View>
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { alignSelf: 'stretch', marginTop: t.spacing.md, marginBottom: t.spacing.md },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: t.spacing.sm },
    chip: {
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.md,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.surfaceAlt,
    },
  })
