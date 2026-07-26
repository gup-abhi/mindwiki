import { useRef } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native'

import { Text } from '@/components/ui'
import { haptics } from '@/lib/haptics'
import { type Theme, useThemedStyles } from '@/theme'

import { type TimelineGap } from './versionFormat'
import { formatRelative } from './versionFormat'

interface VersionChip {
  version: number
  updated_at: number
}

interface VersionChipRowProps {
  versions: VersionChip[]
  gaps: TimelineGap[]
  selectedVersion: number | null
  compareVersion: number | null
  onSelect: (version: number) => void
  isPlaying?: boolean
}

export function VersionChipRow({
  versions,
  gaps,
  selectedVersion,
  compareVersion,
  onSelect,
  isPlaying = false,
}: VersionChipRowProps) {
  const styles = useThemedStyles(makeStyles)
  const gapsByFromVersion = new Map(gaps.map((gap) => [gap.fromVersion, gap]))
  const androidPressStart = useRef<{ version: number; pageX: number; pageY: number } | null>(null)
  const androidPressHandled = useRef<number | null>(null)

  const handlePress = (version: number) => {
    try { haptics.select() } catch { /* optional native feedback */ }
    onSelect(version)
  }

  const handlePressIn = (version: number, event: GestureResponderEvent) => {
    if (Platform.OS !== 'android') return
    androidPressHandled.current = null
    androidPressStart.current = {
      version,
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    }
  }

  const handlePressOut = (version: number, event: GestureResponderEvent) => {
    if (Platform.OS !== 'android') return
    const start = androidPressStart.current
    androidPressStart.current = null
    if (start == null || start.version !== version) return

    const moved = Math.hypot(
      event.nativeEvent.pageX - start.pageX,
      event.nativeEvent.pageY - start.pageY
    )
    if (moved > 8) return

    // RN 0.76 Fabric on Android measures Pressability against pre-scroll
    // coordinates, so onPressOut fires after a horizontal scroll but onPress is
    // dropped. Handle the stationary release here and suppress the ordinary
    // onPress when Fabric does deliver it.
    androidPressHandled.current = version
    handlePress(version)
    setTimeout(() => {
      if (androidPressHandled.current === version) androidPressHandled.current = null
    }, 0)
  }

  const handleNativePress = (version: number) => {
    if (
      Platform.OS === 'android' &&
      (androidPressHandled.current === version || androidPressStart.current?.version === version)
    ) {
      androidPressHandled.current = null
      return
    }
    handlePress(version)
  }

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
      accessibilityLabel="Page versions"
    >
      {versions.map((version, index) => {
        const isSelected = version.version === selectedVersion
        const isCompare = version.version === compareVersion
        const next = versions[index + 1]
        const gap = gapsByFromVersion.get(version.version)
        const gapMatchesNext = gap != null && next?.version === gap.toVersion

        return (
          <View key={version.version} style={styles.itemGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Version ${version.version} from ${formatRelative(version.updated_at)}`}
              accessibilityState={{ selected: isSelected || isCompare }}
              onPressIn={(event) => handlePressIn(version.version, event)}
              onPressOut={(event) => handlePressOut(version.version, event)}
              onPress={() => handleNativePress(version.version)}
              testID={`version-chip-v${version.version}`}
              style={({ pressed }) => [
                styles.chip,
                isSelected && styles.selected,
                isCompare && styles.compare,
                isPlaying && styles.playing,
                pressed && styles.pressed,
              ]}
            >
              <Text
                variant="bodyStrong"
                color={isSelected ? 'primaryText' : 'textPrimary'}
              >
                v{version.version}
              </Text>
              <Text
                variant="caption"
                color={isSelected ? 'primaryText' : 'textMuted'}
              >
                {formatRelative(version.updated_at)}
              </Text>
            </Pressable>
            {gapMatchesNext && (
              <View
                style={styles.gapChip}
                testID={`version-gap-v${gap.fromVersion}`}
                accessibilityLabel={`${gap.missing} prior versions sampled out`}
              >
                <Text variant="caption" color="textMuted" style={styles.gapText}>
                  ⋮ {gap.missing} sampled out
                </Text>
              </View>
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    scroll: {
      marginHorizontal: -t.spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
      backgroundColor: t.colors.bg,
    },
    row: {
      alignItems: 'center',
      gap: t.spacing.xs,
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.xl,
    },
    itemGroup: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs },
    chip: {
      minHeight: 48,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radii.pill,
      borderWidth: 2,
      borderColor: 'transparent',
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.md,
      backgroundColor: t.colors.surfaceAlt,
    },
    selected: {
      backgroundColor: t.colors.accent,
    },
    compare: {
      borderColor: t.colors.success,
    },
    playing: { opacity: 0.8 },
    pressed: { opacity: 0.85 },
    gapChip: {
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: t.radii.pill,
      paddingHorizontal: t.spacing.sm,
      backgroundColor: t.colors.surfaceAlt,
    },
    gapText: { fontStyle: 'italic', fontSize: 10 },
  })