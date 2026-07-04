import React from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type PageTrend } from '@/services/insights/page-trend'

/**
 * A compact weekly-frequency sparkline (one bar per week over the 8-week window,
 * oldest → newest; height = how often the concept came up that week, relative to
 * the busiest week) plus the trend's observational one-liner, which carries the
 * mood shift in plain words. Empty weeks show a faint stub. Purely presentational;
 * the screen only mounts it when the trend has a message.
 */
export const PageTrendView = React.memo(function PageTrendView({ trend }: { trend: PageTrend }) {
  const styles = useThemedStyles(makeStyles)
  const max = Math.max(1, ...trend.weeks.map((w) => w.count))
  return (
    <View testID="page-trend">
      <View style={styles.bars}>
        {trend.weeks.map((w) => (
          <View key={w.weekStart} style={styles.col}>
            <View
              style={[
                styles.bar,
                w.count === 0 ? styles.barEmpty : null,
                { height: `${w.count === 0 ? 6 : Math.max((w.count / max) * 100, 12)}%` },
              ]}
            />
          </View>
        ))}
      </View>
      {trend.message ? (
        <Text variant="caption" color="textSecondary" style={styles.msg}>
          {trend.message}
        </Text>
      ) : null}
    </View>
  )
})

/** One-line key for the sparkline. Shown once per section, not per bar. */
export function TrendLegend() {
  return (
    <Text variant="caption" color="textMuted">
      each bar is a week
    </Text>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    bars: { flexDirection: 'row', alignItems: 'flex-end', height: 36, gap: 3 },
    col: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    bar: { width: '70%', alignSelf: 'center', borderRadius: 2, backgroundColor: t.colors.accent },
    barEmpty: { backgroundColor: t.colors.border },
    msg: { marginTop: t.spacing.sm },
  })
