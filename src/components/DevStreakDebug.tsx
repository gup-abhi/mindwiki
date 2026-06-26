import { useMemo } from 'react'
import { StyleSheet } from 'react-native'

import { Button, Card, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useEntries } from '@/hooks/useEntries'
import { useStreakFreezes } from '@/hooks/useStreakFreezes'
import { computeStreak, dayIndex, streakRescue } from '@/services/notifications/streak'

/**
 * Dev-only readout of the live (clock-relative) streak + freeze state, with a
 * reset. Only rendered under __DEV__, so its data hooks never run in production.
 * Lets you verify spend/earn/at-risk without fighting the device clock — and
 * clear test freezes (which otherwise linger as future-dated rows; see the
 * date-change caveat in the freeze design).
 */
export function DevStreakDebug() {
  const styles = useThemedStyles(makeStyles)
  const { entries } = useEntries()
  const { frozenDays, clearFrozen } = useStreakFreezes()

  const timestamps = useMemo(() => entries.map((e) => e.created_at), [entries])
  const streak = useMemo(
    () => computeStreak(timestamps, Date.now(), frozenDays),
    [timestamps, frozenDays]
  )
  const rescue = useMemo(
    () => streakRescue(timestamps, Date.now(), frozenDays),
    [timestamps, frozenDays]
  )

  const today = dayIndex(Date.now())
  const frozenList = [...frozenDays].sort((a, b) => a - b)

  return (
    <Card variant="sunken">
      <Text variant="caption" color="textSecondary">Today (day index): {today}</Text>
      <Text variant="bodyStrong" style={styles.line}>
        Streak {streak.current} · longest {streak.longest} · ❄ {streak.freezesAvailable}
      </Text>
      <Text variant="caption" color="textSecondary" style={styles.line}>
        Frozen days: {frozenList.length ? frozenList.join(', ') : 'none'}
      </Text>
      <Text variant="caption" color="textSecondary" style={styles.line}>
        At risk: {rescue.atRisk ? `yes — needs ${rescue.freezesNeeded} freeze(s)` : 'no'}
      </Text>
      <Button
        title="Clear streak freezes"
        variant="secondary"
        fullWidth
        onPress={() => void clearFrozen()}
        testID="dev-clear-freezes"
      />
    </Card>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    line: { marginTop: t.spacing.xs },
  })
