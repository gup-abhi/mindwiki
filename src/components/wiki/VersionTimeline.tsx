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
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const VersionTimeline = ({
  versions,
  selectedVersion,
  compareVersion,
  onSelect,
}: Props) => {
  const styles = useThemedStyles(makeStyles)

  return (
    <View style={styles.track}>
      {versions.map((v, i) => {
        const isFirst = i === 0
        const isLast = i === versions.length - 1
        const isSelected = v.version === selectedVersion
        const isCompare = v.version === compareVersion
        const isHighlighted = isSelected || isCompare

        return (
          <View key={v.version} style={styles.row}>
            {/* Dot + connector column */}
            <View style={styles.col}>
              {!isFirst && <View style={[styles.line, styles.lineUp]} />}
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
              {!isLast && <View style={[styles.line, styles.lineDown]} />}
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
