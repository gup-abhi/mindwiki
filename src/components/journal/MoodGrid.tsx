import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { haptics } from '@/lib/haptics'
import { type AffectQuadrant, quadrantFor } from '@/lib/feeling-words'

// The energy×pleasantness capture grid (the circumplex model). The horizontal
// axis is pleasantness 1→5 (this is the entry's `mood`); the vertical is energy,
// high at the top. A single tap sets both. Discrete 5×5 cells (not a free pad) so
// every point is an accessible button and easy to hit. Each cell is tinted by its
// quadrant (red tense, amber upbeat, blue low, green calm) — the colour is the
// circumplex's teaching device — kept soft to stay on the calm palette.

const PLEASANTNESS = [1, 2, 3, 4, 5]
const ENERGY_TOP_DOWN = [5, 4, 3, 2, 1] // top row = high energy
const PLEASANT_EMOJI = ['😣', '😕', '😐', '🙂', '😄']

/** The themed hue for a quadrant; null for the neutral middle band. */
function quadrantHue(q: AffectQuadrant, t: Theme): string | null {
  switch (q) {
    case 'unpleasantHigh':
      return t.colors.danger // red
    case 'pleasantHigh':
      return t.colors.moodOkay // amber
    case 'unpleasantLow':
      return t.colors.graphSituation // blue
    case 'pleasantLow':
      return t.colors.success // green
    default:
      return null // neutral
  }
}

/** A 6-digit hex token at the given alpha — soft pastel tints over the surface. */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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
      <View style={styles.grid}>
        {ENERGY_TOP_DOWN.map((e) => (
          <View key={e} style={styles.row}>
            {PLEASANTNESS.map((p) => {
              const selected = pleasantness === p && energy === e
              const hue = quadrantHue(quadrantFor(p, e), theme)
              const bg = hue
                ? tint(hue, selected ? 0.6 : 0.22)
                : selected
                  ? theme.colors.surfaceSunken
                  : theme.colors.surfaceAlt
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
    cell: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: t.radii.sm,
      borderWidth: 2,
      borderColor: 'transparent', // reserves space so selection adds no layout shift
    },
    cellSelected: { borderColor: t.colors.textPrimary },
    emojiRow: { flexDirection: 'row', marginTop: t.spacing.xs },
    emoji: { flex: 1, textAlign: 'center' },
    axisEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: t.spacing.xs },
  })
