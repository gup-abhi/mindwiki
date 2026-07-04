import React from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { affectColor } from '@/lib/affect-colors'
import { type AffectQuadrant } from '@/lib/feeling-words'
import { type AffectMap } from '@/services/insights/affect-map'

// Read-only density view of the energy×pleasantness grid — same orientation and
// corner colors as the capture MoodGrid (x = pleasantness left→right, y = energy
// high at top), so it reads instantly. Each cell's opacity ∝ how often feelings
// landed there; empty cells stay barely tinted.

const PLEASANTNESS = [1, 2, 3, 4, 5]
const ENERGY_TOP_DOWN = [5, 4, 3, 2, 1]
const COUNT_LABEL_MIN = 2 // only the denser cells show a number, so the grid stays clean

// The dominant region's word, pinned in the grid corner that region occupies.
// Placement is derived from two flex axes so all five cases fall out cleanly.
// (Narrow to the three values valid for BOTH justifyContent and alignItems.)
type Align = 'flex-start' | 'flex-end' | 'center'
const DOMINANT: Record<AffectQuadrant, { label: string; v: Align; h: Align }> = {
  unpleasantHigh: { label: 'Tense', v: 'flex-start', h: 'flex-start' }, // top-left
  pleasantHigh: { label: 'Upbeat', v: 'flex-start', h: 'flex-end' }, // top-right
  unpleasantLow: { label: 'Low', v: 'flex-end', h: 'flex-start' }, // bottom-left
  pleasantLow: { label: 'Calm', v: 'flex-end', h: 'flex-end' }, // bottom-right
  neutral: { label: 'Balanced', v: 'center', h: 'center' },
}

export const AffectMapView = React.memo(function AffectMapView({ map }: { map: AffectMap }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const countAt = (p: number, e: number): number =>
    map.cells.find((c) => c.pleasantness === p && c.energy === e)?.count ?? 0
  const pin = DOMINANT[map.dominant]

  return (
    <View testID="affect-map">
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
                const count = countAt(p, e)
                const px = (p - 1) / 4
                const py = (e - 1) / 4
                const alpha = count === 0 ? 0.05 : 0.2 + 0.6 * (map.max > 0 ? count / map.max : 0)
                return (
                  <View key={p} style={[styles.cell, { backgroundColor: affectColor(theme, px, py, alpha) }]}>
                    {count >= COUNT_LABEL_MIN ? (
                      <Text variant="caption" color="textSecondary" style={styles.count}>
                        {count}
                      </Text>
                    ) : null}
                  </View>
                )
              })}
            </View>
          ))}
          {/* The dominant region's label, pinned in its corner. Non-interactive. */}
          <View style={[styles.pinLayer, { justifyContent: pin.v, alignItems: pin.h }]} pointerEvents="none">
            <View style={styles.pin}>
              <Text variant="caption" color="textPrimary">
                {pin.label}
              </Text>
            </View>
          </View>
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
      <Text variant="caption" color="textSecondary" style={styles.summary}>
        {map.summary}
      </Text>
    </View>
  )
})

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    axisCenter: { textAlign: 'center', marginVertical: t.spacing.xs },
    gridRow: { flexDirection: 'row', alignItems: 'center' },
    sideCol: { width: 18, alignItems: 'center', justifyContent: 'center' },
    sideLabel: { width: 90, textAlign: 'center' },
    sideLeft: { transform: [{ rotate: '-90deg' }] },
    sideRight: { transform: [{ rotate: '90deg' }] },
    grid: { flex: 1, gap: t.spacing.xs },
    row: { flexDirection: 'row', gap: t.spacing.xs },
    cell: { flex: 1, aspectRatio: 1, borderRadius: t.radii.sm, alignItems: 'center', justifyContent: 'center' },
    count: { opacity: 0.7 },
    pinLayer: { ...StyleSheet.absoluteFillObject, padding: t.spacing.xs },
    pin: {
      paddingHorizontal: t.spacing.sm,
      paddingVertical: 2,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.surface,
    },
    summary: { marginTop: t.spacing.md },
  })
