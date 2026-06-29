import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'

// The energy×pleasantness capture grid (the circumplex model). The horizontal
// axis is pleasantness 1→5 (this is the entry's `mood`); the vertical is energy,
// high at the top. A single tap sets both. Discrete 5×5 cells (not a free pad) so
// every point is an accessible button and easy to hit. Cells are tinted by a
// smooth 4-corner gradient — red (tense), amber (upbeat), blue (low), green
// (calm) — so the grid reads as continuous regions (no hard gray middle), while
// the centre still blends to a muted neutral.

const PLEASANTNESS = [1, 2, 3, 4, 5]
const ENERGY_TOP_DOWN = [5, 4, 3, 2, 1] // top row = high energy

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const rgba = (c: RGB, a: number): string => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`

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
  // Quadrant corners: top = high energy, left = unpleasant.
  const tl = hexToRgb(theme.colors.danger) // unpleasant + high (red)
  const tr = hexToRgb(theme.colors.moodOkay) // pleasant + high (amber)
  const bl = hexToRgb(theme.colors.graphSituation) // unpleasant + low (blue)
  const br = hexToRgb(theme.colors.success) // pleasant + low (green)

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
                const hue = mix(mix(bl, br, px), mix(tl, tr, px), py) // bilinear blend
                const bg = rgba(hue, selected ? 0.62 : 0.22)
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
      borderRadius: t.radii.sm,
      borderWidth: 2,
      borderColor: 'transparent', // reserves space so selection adds no layout shift
    },
    cellSelected: { borderColor: t.colors.textPrimary },
  })
