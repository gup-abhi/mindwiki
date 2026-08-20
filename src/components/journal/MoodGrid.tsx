import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { affectColor } from '@/lib/affect-colors'
import { haptics } from '@/lib/haptics'

// The energy×pleasantness capture grid (the circumplex model). The horizontal
// axis is pleasantness 1→5 (this is the entry's `mood`); the vertical is energy,
// high at the top. A single tap sets both. Discrete 5×5 cells (not a free pad) so
// every point is an accessible button and easy to hit. Cells are tinted by a
// smooth 4-corner gradient — red (tense), amber (upbeat), blue (low), green
// (calm) — so the grid reads as continuous regions (no hard gray middle), while
// the centre still blends to a muted neutral. The corner colours live in
// affect-colors.ts, shared with the Trends affect map.

const PLEASANTNESS = [1, 2, 3, 4, 5]
const ENERGY_TOP_DOWN = [5, 4, 3, 2, 1] // top row = high energy

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
  const theme = useTheme()

  return (
    <View>
      <Text variant="caption" color="textMuted" style={styles.axisCenter}>
        High energy
      </Text>
      <View style={styles.gridRow}>
        <View style={styles.sideCol}>
          <Text variant="caption" color="textMuted" style={[styles.sideLabel, styles.sideLeft]}>
            Unpleasant
          </Text>
        </View>
        <View style={styles.grid}>
          {ENERGY_TOP_DOWN.map((e) => (
            <View key={e} style={styles.row}>
              {PLEASANTNESS.map((p) => {
                const selected = pleasantness === p && energy === e
                const px = (p - 1) / 4 // 0 unpleasant → 1 pleasant
                const py = (e - 1) / 4 // 0 low → 1 high energy
                const bg = affectColor(theme, px, py, selected ? 0.62 : 0.22)
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
                    style={[styles.cell, { backgroundColor: bg }, selected && styles.cellSelected]}
                  />
                )
              })}
            </View>
          ))}
        </View>
        <View style={styles.sideCol}>
          <Text variant="caption" color="textMuted" style={[styles.sideLabel, styles.sideRight]}>
            Pleasant
          </Text>
        </View>
      </View>
      <Text variant="caption" color="textMuted" style={styles.axisCenter}>
        Low energy
      </Text>
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    axisCenter: { textAlign: 'center', marginVertical: t.spacing.xs },
    gridRow: { flexDirection: 'row', alignItems: 'center' },
    sideCol: { width: 18, alignItems: 'center', justifyContent: 'center' },
    // The label box is wide enough not to wrap, then rotated to run vertically;
    // it overflows the narrow column with empty space, so the grid keeps the rest.
    sideLabel: { width: 90, textAlign: 'center' },
    sideLeft: { transform: [{ rotate: '-90deg' }] }, // reads bottom→top
    sideRight: { transform: [{ rotate: '90deg' }] }, // reads top→bottom
    grid: { flex: 1, gap: t.spacing.xs },
    row: { flexDirection: 'row', gap: t.spacing.xs },
    cell: {
      flex: 1,
      aspectRatio: 1,
      minHeight: 48,
      borderRadius: t.radii.sm,
      borderWidth: 2,
      borderColor: 'transparent', // reserves space so selection adds no layout shift
    },
    cellSelected: { borderColor: t.colors.textPrimary },
  })
