import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Button, Card, Screen, Text } from '@/components/ui'
import { PageTrendView, TrendLegend } from '@/components/wiki/PageTrendView'
import { AffectMapView } from '@/components/insights/AffectMapView'
import { DistortionTrendView } from '@/components/insights/DistortionTrendView'
import { useEntries } from '@/hooks/useEntries'
import { useStreakFreezes } from '@/hooks/useStreakFreezes'
import { useTrendingPages } from '@/hooks/useWiki'
import {
  moodByDay,
  monthMoodGrid,
  moodByWeekdayTime,
  type DayMood,
  type MonthCell,
  type TimeOfDay,
  type WeekdayTimeMood,
} from '@/services/insights/mood-stats'
import { computeAffectMap } from '@/services/insights/affect-map'
import { computeDistortionTrend } from '@/services/insights/distortion-trend'
import { streakRescue } from '@/services/notifications/streak'
import { StreakRescueModal } from '@/components/StreakRescueModal'
import { useStreakTimestamps } from '@/hooks/useStreakTimestamps'
import { type Theme, moodColorKey, useTheme, useThemedStyles } from '@/theme'

const TREND_DAYS = 14

export default function TrendsScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { entries } = useEntries()
  const { timestamps } = useStreakTimestamps()
  const { frozenDays, applyFreezes } = useStreakFreezes()
  const [rescueOpen, setRescueOpen] = useState(false)

  const trending = useTrendingPages()
  const now = Date.now()
  const rescue = useMemo(() => streakRescue(timestamps, now, frozenDays), [timestamps, now, frozenDays])
  const series = useMemo(() => moodByDay(entries, now, TREND_DAYS), [entries, now])
  const affect = useMemo(() => computeAffectMap(entries, now), [entries, now])
  const distortions = useMemo(() => computeDistortionTrend(entries, now), [entries, now])
  const rhythm = useMemo(() => moodByWeekdayTime(entries, now), [entries, now])
  const today = new Date(now)
  const weeks = useMemo(
    () => monthMoodGrid(entries, today.getFullYear(), today.getMonth()),
    [entries, today]
  )
  const monthLabel = today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <Screen scroll>
      <Text variant="label" color="accent" onPress={() => router.back()}>
        ← Back
      </Text>
      <Text variant="title" style={styles.h1}>
        Reflection rhythm
      </Text>
      <Text variant="body" color="textSecondary" style={styles.intro}>
        Your writing pattern over time. Today is always open.
      </Text>

      {rescue.atRisk && (
        <Card style={styles.card} testID="streak-rescue-card">
          <Text variant="subtitle">A missed day can be marked as a pause</Text>
          <Text variant="body" color="textSecondary" style={styles.rescueBody}>
            You have {rescue.freezesNeeded} {rescue.freezesNeeded === 1 ? 'freeze' : 'freezes'} available to mark the pause.
          </Text>
          <Button
            title="Review pause option"
            variant="secondary"
            onPress={() => setRescueOpen(true)}
            testID="open-streak-rescue"
          />
        </Card>
      )}

      {entries.length === 0 ? (
        <Text variant="body" color="textMuted" style={styles.empty}>
          Write a few entries and your mood trends will show up here.
        </Text>
      ) : (
        <>
          <Card style={styles.card}>
            <Text variant="subtitle" color="textSecondary" style={styles.cardTitle}>
              Mood · last {TREND_DAYS} days
            </Text>
            <MoodTrendChart data={series} />
          </Card>

          {affect && (
            <Card style={styles.card}>
              <Text variant="subtitle" color="textSecondary" style={styles.cardTitle}>
                Where your feelings land
              </Text>
              <AffectMapView map={affect} />
            </Card>
          )}

          {distortions && (
            <Card style={styles.card}>
              <Text variant="subtitle" color="textSecondary" style={styles.cardTitle}>
                Thinking patterns
              </Text>
              <DistortionTrendView trend={distortions} />
            </Card>
          )}

          <Card style={styles.card}>
            <Text variant="subtitle" color="textSecondary" style={styles.cardTitle}>
              {monthLabel}
            </Text>
            <MoodCalendar weeks={weeks} year={today.getFullYear()} month={today.getMonth()} frozenDays={frozenDays} />
          </Card>

          {rhythm && (
            <Card style={styles.card}>
              <Text variant="subtitle" color="textSecondary" style={styles.cardTitle}>
                Mood by day and time
              </Text>
              <MoodRhythm data={rhythm} />
            </Card>
          )}

          {trending.length > 0 && (
            <Card style={styles.card}>
              <Text variant="subtitle" color="textSecondary" style={styles.cardTitle}>
                What’s changing
              </Text>
              <TrendLegend />
              {trending.map(({ page, trend }) => (
                <Pressable
                  key={page.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open the ${page.title} page`}
                  onPress={() => router.push(`/wiki/${page.id}`)}
                  style={styles.trendRow}
                  testID="trend-row"
                >
                  <PageTrendView trend={trend} />
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}

      <StreakRescueModal
        visible={rescueOpen}
        streakLength={rescue.streakLength}
        freezesNeeded={rescue.freezesNeeded}
        onUse={() => {
          void applyFreezes(rescue.daysToFreeze)
          setRescueOpen(false)
        }}
        onDismiss={() => setRescueOpen(false)}
      />
    </Screen>
  )
}

/** A simple bar per day, height ∝ mood, colored on the mood scale. */
function MoodTrendChart({ data }: { data: DayMood[] }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  return (
    <View style={styles.chart}>
      <View style={styles.bars}>
        {data.map((d) => {
          const frac = d.avg == null ? 0 : d.avg / 5
          const color =
            d.avg == null ? theme.colors.divider : theme.colors[moodColorKey(Math.round(d.avg))]
          return (
            <View key={d.date} style={styles.barCol}>
              <View
                style={[styles.bar, { height: `${d.avg == null ? 2 : Math.max(frac * 100, 8)}%`, backgroundColor: color }]}
              />
            </View>
          )
        })}
      </View>
      <View style={styles.barLabels}>
        {data.map((d) => (
          <Text key={d.date} variant="caption" color="textMuted" style={styles.barLabel}>
            {new Date(d.date).getDate()}
          </Text>
        ))}
      </View>
    </View>
  )
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** A month grid with each day tinted on the mood scale (empty = no entry).
 * Frozen days (streak-freeze) show ❄ on the cell. */
function MoodCalendar({ weeks, year, month, frozenDays }: { weeks: MonthCell[][]; year: number; month: number; frozenDays: Set<number> }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  return (
    <View>
      <View style={styles.calRow}>
        {DOW.map((d, i) => (
          <Text key={i} variant="caption" color="textMuted" style={styles.calHead}>
            {d}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.calRow}>
          {week.map((cell, ci) => {
            if (cell.day == null) return <View key={ci} style={styles.cell} />
            const filled = cell.avg != null
            const dayIdx = cell.day != null ? Math.floor(Date.UTC(year, month, cell.day) / 86_400_000) : -1
            const isFrozen = cell.day != null ? frozenDays.has(dayIdx) : false
            return (
              <View key={ci} style={styles.cell}>
                <View
                  style={[
                    styles.cellInner,
                    filled
                      ? { backgroundColor: theme.colors[moodColorKey(Math.round(cell.avg as number))] }
                      : styles.cellEmpty,
                  ]}
                >
                  {isFrozen ? (
                    <Text variant="caption" color={filled ? 'textInverse' : 'textMuted'}>
                      ❄
                    </Text>
                  ) : (
                    <Text variant="caption" color={filled ? 'textInverse' : 'textMuted'}>
                      {cell.day}
                    </Text>
                  )}
                </View>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const SLOT_LABEL: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

/**
 * A 3 (time of day) × 7 (weekday, Monday-first) heatmap of average mood, tinted on
 * the same mood scale as the calendar. Empty slots show a faint outline.
 */
function MoodRhythm({ data }: { data: WeekdayTimeMood }) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  return (
    <View>
      <View style={styles.rhythmRow}>
        <View style={styles.rhythmLabel} />
        {DOW.map((d, i) => (
          <Text key={i} variant="caption" color="textMuted" style={styles.rhythmHead}>
            {d}
          </Text>
        ))}
      </View>
      {data.rows.map((row) => (
        <View key={row.slot} style={styles.rhythmRow}>
          <Text variant="caption" color="textMuted" style={styles.rhythmLabel} numberOfLines={1}>
            {SLOT_LABEL[row.slot]}
          </Text>
          {row.cells.map((c, wd) => (
            <View key={wd} style={styles.rhythmCellWrap}>
              <View
                style={[
                  styles.rhythmCell,
                  c.avg == null
                    ? styles.rhythmEmpty
                    : { backgroundColor: theme.colors[moodColorKey(Math.round(c.avg))] },
                ]}
              />
            </View>
          ))}
        </View>
      ))}
      {data.message ? (
        <Text variant="caption" color="textSecondary" style={styles.rhythmMsg}>
          {data.message}
        </Text>
      ) : null}
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    h1: { marginTop: t.spacing.sm },
    intro: { marginTop: t.spacing.xs },
    card: { marginTop: t.spacing.lg },
    rescueBody: { marginTop: t.spacing.xs, marginBottom: t.spacing.md },
    cardTitle: { marginBottom: t.spacing.md },
    rhythmRow: { flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.xs },
    rhythmLabel: { width: 72 },
    rhythmHead: { flex: 1, textAlign: 'center' },
    rhythmCellWrap: { flex: 1, padding: 2 },
    rhythmCell: { height: 24, borderRadius: 6 },
    rhythmEmpty: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },
    rhythmMsg: { marginTop: t.spacing.sm },
    empty: { marginTop: t.spacing['2xl'] },
    trendRow: { paddingVertical: t.spacing.md },
    chart: { gap: t.spacing.sm },
    bars: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3 },
    barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    bar: { width: '72%', alignSelf: 'center', borderRadius: 3 },
    barLabels: { flexDirection: 'row', gap: 3 },
    barLabel: { flex: 1, textAlign: 'center' },
    calRow: { flexDirection: 'row' },
    calHead: { flex: 1, textAlign: 'center', marginBottom: t.spacing.xs },
    cell: { flex: 1, aspectRatio: 1, padding: 2 },
    cellInner: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    cellEmpty: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },
  })
