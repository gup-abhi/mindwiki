import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type LineagePage } from '@/services/wiki/engine'

/**
 * A Home card showing which wiki pages the user's most recent entry contributed to.
 * Pending synthesis is shown without implying a page change. Each page name is
 * tappable to open it.
 */
export function WhatChangedCard({
  pages,
  pending = false,
}: {
  pages: LineagePage[] | null
  pending?: boolean
}) {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)

  if (!pages || pages.length === 0) {
    if (!pending) return null
    return (
      <Card variant="sunken" style={styles.card} testID="what-changed-pending">
        <Text variant="caption" color="accent">
          Private synthesis in progress
        </Text>
        <Text variant="caption" color="textMuted" style={styles.pendingText}>
          Your reflection is saved. Any wiki change will appear here once it is confirmed.
        </Text>
      </Card>
    )
  }

  return (
    <Card variant="sunken" style={styles.card} testID="what-changed-card">
      <Text variant="caption" color="accent">
        This reflection contributed to…
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
    pendingText: { marginTop: t.spacing.xs },
    chip: {
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.md,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.surfaceAlt,
    },
  })
