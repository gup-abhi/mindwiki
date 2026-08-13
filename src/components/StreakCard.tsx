import { StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Card, Text } from '@/components/ui'
import { type DayCell } from '@/services/notifications/streak'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

interface StreakCardProps {
  current: number
  longest: number
  week: DayCell[]
  /** Contextual one-liner from homeMessage(). */
  headline: string
  /** Lifetime totals, folded in as the card's footer. */
  entries: number
  insights: number
  /** Freezes the user currently holds — each covers one missed day. */
  freezesAvailable: number
  /** Tapping the card opens the Trends screen. */
  onPress?: () => void
}

const count = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`

/** Home streak summary: the live count, the record to beat, a Mon→Sun strip
 * showing the week, and lifetime entry/insight totals. */
export function StreakCard({ current, longest, week, headline, entries, insights, freezesAvailable, onPress }: StreakCardProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  return (
    <Card variant="sunken" style={styles.card} onPress={onPress}>
      <View style={styles.topRow}>
        <View>
          {current > 0 ? (
            <Text variant="display">{current}</Text>
          ) : (
            <Text variant="subtitle">Start a reflection rhythm</Text>
          )}
          {current > 0 ? (
            <Text variant="caption" color="textMuted">
              days in a row
            </Text>
          ) : null}
        </View>
        <View style={styles.topRight}>
          {freezesAvailable > 0 ? (
            <View style={styles.best} testID="streak-freezes">
              <Text variant="caption" color="textMuted">
                Freezes
              </Text>
              <Text variant="subtitle" color="textSecondary">
                ❄ {freezesAvailable}
              </Text>
            </View>
          ) : null}
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
          {onPress ? (
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          ) : null}
        </View>
      </View>

      <View style={styles.week}>
        {week.map((cell, i) => (
          <DayDot key={i} cell={cell} />
        ))}
      </View>

      <Text variant="caption" color="accent" style={styles.headline}>
        {headline}
      </Text>

      <View style={styles.stats}>
        <Text variant="caption" color="textSecondary">
          {count(entries, 'entry', 'entries')} · {count(insights, 'insight', 'insights')}
        </Text>
      </View>
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
    topRight: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
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
    stats: {
      marginTop: t.spacing.lg,
      paddingTop: t.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
  })
