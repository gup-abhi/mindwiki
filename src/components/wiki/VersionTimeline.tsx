import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'

export interface TimelineVersion {
  version: number
  updated_at: number
}

interface Props {
  versions: TimelineVersion[]
  selectedVersion: number | null
  compareVersion: number | null
  onSelect: (version: number) => void
  /** Sampled-history gaps between retained versions. When a gap entry covers
   *  two adjacent `versions` entries, the connector between them is replaced
   *  with a 'sampled' chip so a v2 ↔ v14 jump is never drawn as a single step. */
  gaps?: TimelineGap[]
}

/** A sampled-history gap between two retained versions. When present, the
 *  timeline collapses the connecting line between the two versions and shows a
 *  'sampled' indicator instead — so a jump like v2 → v14 (versions 3–13
 *  discarded by the retained-history cap) is never drawn as a single rename. */
export interface TimelineGap {
  fromVersion: number
  toVersion: number
  /** How many version numbers were discarded between the two retained ones
 *  (e.g. 11 for v2 → v14). */
  missing: number
}

export function formatRelative(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || !Number.isFinite(now) || ts < 0 || ts > now) return 'date unavailable'
  const diff = now - ts
  const days = Math.floor(diff / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  const date = new Date(ts)
  return Number.isNaN(date.getTime())
    ? 'date unavailable'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const VersionTimeline = ({
  versions,
  selectedVersion,
  compareVersion,
  onSelect,
  gaps = [],
}: Props) => {
  const styles = useThemedStyles(makeStyles)
  // Lookup from the version number BEFORE a gap to the gap entry, so we can
  // detect 'this row's connector up to the next row crosses a sampled gap'.
  const gapBefore = new Map<number, TimelineGap>()
  for (const g of gaps) gapBefore.set(g.fromVersion, g)

  return (
    <View style={styles.track}>
      {versions.map((v, i) => {
        const isFirst = i === 0
        const isLast = i === versions.length - 1
        const isSelected = v.version === selectedVersion
        const isCompare = v.version === compareVersion
        const isHighlighted = isSelected || isCompare
        // The connector up from this row to the PREVIOUS one crosses a sampled
        // gap when this row's version is the `toVersion` of an existing gap.
        // (gapBefore is keyed by fromVersion, so we look up the prev version.)
        const prev = i > 0 ? versions[i - 1] : null
        const gapAbove = prev != null ? gapBefore.get(prev.version) : undefined
        // The connector DOWN to the next row crosses a gap when this row's
        // version is the `fromVersion` of a gap.
        const gapBelow = gapBefore.get(v.version)

        return (
          <View key={v.version} style={styles.row}>
            {/* Dot + connector column */}
            <View style={styles.col}>
              {!isFirst && (gapAbove ? (
                <View style={[styles.line, styles.lineUp, styles.lineGap]} />
              ) : (
                <View style={[styles.line, styles.lineUp]} />
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Version ${v.version} from ${formatRelative(v.updated_at)}`}
                onPress={() => onSelect(v.version)}
                style={[
                  styles.dot,
                  isSelected ? styles.dotSelected : isCompare ? styles.dotCompare : styles.dotDefault,
                ]}
                testID={`timeline-dot-v${v.version}`}
              />
              {!isLast && (gapBelow ? (
                <View style={[styles.line, styles.lineDown, styles.lineGap]} />
              ) : (
                <View style={[styles.line, styles.lineDown]} />
              ))}
            </View>

            {/* Label — tappable same as the dot */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Version ${v.version} from ${formatRelative(v.updated_at)}`}
              onPress={() => onSelect(v.version)}
              style={[styles.label, isHighlighted && styles.labelHighlight]}
              testID={`timeline-label-v${v.version}`}
            >
              <Text
                variant={isHighlighted ? 'bodyStrong' : 'caption'}
                color={isHighlighted ? 'textPrimary' : 'textSecondary'}
              >
                v{v.version}
              </Text>
              <Text
                variant="caption"
                color={isHighlighted ? 'textSecondary' : 'textMuted'}
              >
                {formatRelative(v.updated_at)}
              </Text>
              {gapAbove && (
                <Text
                  variant="caption"
                  color="textMuted"
                  style={styles.samplingChip}
                >
                  ⋮ {gapAbove.missing} prior version{gapAbove.missing === 1 ? '' : 's'} sampled out
                </Text>
              )}
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    track: { gap: 0 },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
    col: { width: 28, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
    line: { width: 2, flex: 1, backgroundColor: t.colors.border },
    lineUp: { marginBottom: -1 },
    lineDown: { marginTop: -1 },
    lineGap: { backgroundColor: t.colors.textMuted, opacity: 0.45, width: 1.5 },
    // Visual 'sampled history' chip below a version whose prior row is across
    // a retained-history gap — dashed indicators mark it without drawing a
    // solid step (which would mislead the eye into reading it as one rename).
    samplingChip: { fontStyle: 'italic', marginTop: 2, fontSize: 10 },
    dot: { width: 14, height: 14, borderRadius: 7, zIndex: 1 },
    dotDefault: { backgroundColor: t.colors.textMuted },
    dotSelected: {
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: t.colors.accent,
      borderWidth: 3,
      borderColor: t.colors.surfaceAlt,
    },
    dotCompare: {
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: t.colors.accent,
      borderWidth: 3,
      borderColor: t.colors.success,
    },
    label: { marginLeft: t.spacing.sm, paddingVertical: t.spacing.xs },
    labelHighlight: {
      backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radii.sm,
      paddingHorizontal: t.spacing.sm,
      marginLeft: t.spacing.xs,
    },
  })
