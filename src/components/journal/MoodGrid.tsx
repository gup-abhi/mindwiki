import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'

// The energy×pleasantness capture grid (the circumplex model). The horizontal
// axis is pleasantness 1→5 (this is the entry's `mood`); the vertical is energy,
// high at the top. A single tap sets both. Discrete 5×5 cells (not a free pad) so
// every point is an accessible button and easy to hit.

const PLEASANTNESS = [1, 2, 3, 4, 5]
const ENERGY_TOP_DOWN = [5, 4, 3, 2, 1] // top row = high energy
const PLEASANT_EMOJI = ['😣', '😕', '😐', '🙂', '😄']

export function MoodGrid({
  pleasantness,
  energy,
  onPick,
}: {
  pleasantness: number | null
  energy: number | null
  onPick: (pleasantness: number, energy: number) => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View>
      <Text variant="caption" color="textMuted" style={styles.axisCenter}>
        High energy
      </Text>
      <View style={styles.grid}>
        {ENERGY_TOP_DOWN.map((e) => (
          <View key={e} style={styles.row}>
            {PLEASANTNESS.map((p) => {
              const selected = pleasantness === p && energy === e
              return (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Pleasantness ${p} of 5, energy ${e} of 5`}
                  testID={`affect-${p}-${e}`}
                  onPress={() => {
                    haptics.select()
                    onPick(p, e)
                  }}
                  style={[styles.cell, selected && styles.cellSelected]}
                />
              )
            })}
          </View>
        ))}
      </View>
      <Text variant="caption" color="textMuted" style={styles.axisCenter}>
        Low energy
      </Text>
      <View style={styles.emojiRow}>
        {PLEASANT_EMOJI.map((em, i) => (
          <Text key={i} variant="body" style={styles.emoji}>
            {em}
          </Text>
        ))}
      </View>
      <View style={styles.axisEnds}>
        <Text variant="caption" color="textMuted">
          Unpleasant
        </Text>
        <Text variant="caption" color="textMuted">
          Pleasant
        </Text>
      </View>
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    axisCenter: { textAlign: 'center', marginVertical: t.spacing.xs },
    grid: { gap: t.spacing.xs },
    row: { flexDirection: 'row', gap: t.spacing.xs },
    cell: { flex: 1, aspectRatio: 1, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt },
    cellSelected: { backgroundColor: t.colors.accent },
    emojiRow: { flexDirection: 'row', marginTop: t.spacing.xs },
    emoji: { flex: 1, textAlign: 'center' },
    axisEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: t.spacing.xs },
  })
