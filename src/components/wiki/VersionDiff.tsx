import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { wordDiff, type DiffToken } from '@/services/wiki/evolution'

interface Props {
  contentA: string
  contentB: string
}

/**
 * Word-level diff renderer: green for additions, red+strikethrough for removals,
 * default for unchanged text. Pure presentational — diff computation is done in
 * a useMemo above the component.
 */
export const VersionDiff = ({ contentA, contentB }: Props) => {
  const styles = useThemedStyles(makeStyles)
  const tokens: DiffToken[] = useMemo(() => wordDiff(contentA, contentB), [contentA, contentB])

  return (
    <View style={styles.container} testID="version-diff">
      <View style={styles.legend}>
        <View style={[styles.legendSwatch, styles.legendAdded]} />
        <Text variant="caption" color="textMuted">Added</Text>
        <View style={[styles.legendSwatch, styles.legendRemoved]} />
        <Text variant="caption" color="textMuted">Removed</Text>
      </View>
      <View style={styles.content}>
        {tokens.length === 0 ? (
          <Text variant="body" color="textMuted">(empty)</Text>
        ) : (
          tokens.map((t, i) => (
            <Text
              key={i}
              variant="body"
              style={[
                t.type === 'added' && styles.textAdded,
                t.type === 'removed' && styles.textRemoved,
              ]}
            >
              {t.text}
            </Text>
          ))
        )}
      </View>
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radii.md,
      padding: t.spacing.md,
      gap: t.spacing.sm,
    },
    legend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
    },
    legendSwatch: { width: 12, height: 12, borderRadius: 2 },
    legendAdded: { backgroundColor: t.colors.success },
    legendRemoved: { backgroundColor: t.colors.danger },
    content: { flexDirection: 'row', flexWrap: 'wrap' },
    textAdded: {
      backgroundColor: t.colors.success,
      color: t.colors.textInverse,
    },
    textRemoved: {
      backgroundColor: t.colors.danger,
      color: t.colors.textInverse,
      textDecorationLine: 'line-through',
    },
  })
