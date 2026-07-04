import React from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type DistortionTrend } from '@/services/insights/distortion-trend'

/**
 * The distortion-frequency trend: one bar per week over the 8-week window
 * (oldest → newest, height = the share of that week's entries carrying a
 * distortion), the observational one-liner, and the window's most common
 * patterns in plain CBT names. Purely presentational.
 */
export const DistortionTrendView = React.memo(function DistortionTrendView({
  trend,
}: {
  trend: DistortionTrend
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View testID="distortion-trend">
      <View style={styles.bars}>
        {trend.weeks.map((w) => (
          <View key={w.weekStart} style={styles.col}>
            <View
              style={[
                styles.bar,
                w.rate == null || w.rate === 0 ? styles.barEmpty : null,
                { height: `${w.rate == null ? 6 : Math.max(w.rate * 100, 8)}%` },
              ]}
            />
          </View>
        ))}
      </View>
      <Text variant="caption" color="textMuted" style={styles.legend}>
        each bar is a week · taller means more distorted thinking
      </Text>
      {trend.message ? (
        <Text variant="caption" color="textSecondary" style={styles.msg}>
          {trend.message}
        </Text>
      ) : null}

      {trend.top.length > 0 && (
        <View style={styles.top}>
          <Text variant="caption" color="textMuted" style={styles.topHead}>
            Most common lately
          </Text>
          {trend.top.map((d) => (
            <View key={d.name} style={styles.topRow}>
              <Text variant="body" color="textSecondary" style={styles.topName} numberOfLines={1}>
                {d.name}
              </Text>
              <Text variant="caption" color="textMuted">
                {d.count}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
})

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    bars: { flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 3 },
    col: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    bar: { width: '70%', alignSelf: 'center', borderRadius: 3, backgroundColor: t.colors.accent },
    barEmpty: { backgroundColor: t.colors.border },
    legend: { marginTop: t.spacing.xs },
    msg: { marginTop: t.spacing.sm },
    top: { marginTop: t.spacing.lg },
    topHead: { marginBottom: t.spacing.xs },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: t.spacing.xs,
    },
    topName: { flex: 1, marginRight: t.spacing.sm },
  })
