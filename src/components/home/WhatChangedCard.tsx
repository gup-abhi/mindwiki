import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type LineagePage } from '@/services/wiki/engine'

/**
 * A Home card showing which wiki pages the user's most recent entry reshaped.
 * Null or empty → renders nothing. Each page name is tappable to open it.
 */
export function WhatChangedCard({ pages }: { pages: LineagePage[] | null }) {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)

  if (!pages || pages.length === 0) return null

  return (
    <Card variant="sunken" style={styles.card} testID="what-changed-card">
      <Text variant="caption" color="accent">
        Your last entry reshaped
      </Text>
      <View style={styles.row}>
        {pages.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Open the ${p.title} page`}
            onPress={() => router.push(`/wiki/${p.id}`)}
            style={styles.chip}
            testID="what-changed-page"
          >
            <Text variant="body">{p.title}</Text>
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
