import { StyleSheet, View } from 'react-native'

import { Card, Text } from '@/components/ui'
import { type DayCell } from '@/services/notifications/streak'
import { type Theme, useThemedStyles } from '@/theme'

interface StreakCardProps {
  current: number
  longest: number
  week: DayCell[]
  /** Encouraging one-liner from streakStage(). */
  headline: string
}

/** Home streak summary: the live count, the record to beat, and a Mon→Sun strip
 * showing the week — wrote / freeze / missed / today. */
export function StreakCard({ current, longest, week, headline }: StreakCardProps) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Card variant="sunken" style={styles.card}>
      <View style={styles.topRow}>
        <View>
          {current > 0 ? (
            <Text variant="display">🔥 {current}</Text>
          ) : (
            <Text variant="subtitle">Start your streak</Text>
          )}
          {current > 0 ? (
            <Text variant="caption" color="textMuted">
              day streak
            </Text>
          ) : null}
        </View>
        {longest > 0 ? (
          <View style={styles.best}>
            <Text variant="caption" color="textMuted">
              Best
            </Text>
            <Text variant="subtitle" color="textSecondary">
              {longest}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.week}>
        {week.map((cell, i) => (
          <DayDot key={i} cell={cell} />
        ))}
      </View>

      <Text variant="caption" color="accent" style={styles.headline}>
        {headline}
      </Text>
    </Card>
  )
}

function DayDot({ cell }: { cell: DayCell }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.day}>
      <Text variant="caption" color={cell.isToday ? 'accent' : 'textMuted'}>
        {cell.label}
      </Text>
      <View style={[styles.dot, dotStyle(styles, cell), cell.isToday && styles.dotToday]}>
        {cell.state === 'freeze' ? <Text style={styles.flake}>❄</Text> : null}
      </View>
    </View>
  )
}

function dotStyle(styles: ReturnType<typeof makeStyles>, cell: DayCell) {
  switch (cell.state) {
    case 'wrote':
      return styles.dotWrote
    case 'freeze':
      return styles.dotFreeze
    case 'missed':
      return styles.dotMissed
    default:
      return styles.dotFuture
  }
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { alignSelf: 'stretch', marginTop: t.spacing.lg },
    topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    best: { alignItems: 'flex-end' },
    week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: t.spacing.lg },
    day: { alignItems: 'center', gap: t.spacing.xs },
    dot: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotWrote: { backgroundColor: t.colors.accent },
    dotFreeze: { backgroundColor: t.colors.accentMuted },
    dotMissed: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },
    dotFuture: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.divider },
    dotToday: { borderWidth: 2, borderColor: t.colors.accent },
    flake: { fontSize: 13, color: t.colors.accentText },
    headline: { marginTop: t.spacing.lg },
  })
