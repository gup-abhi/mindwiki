import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Card, Divider, EmptyState, ListRow, Screen, Text } from '@/components/ui'
import { Graph3D } from '@/components/graph/Graph3D'
import { MoversStrip } from '@/components/insights/MoversStrip'
import { MergeSuggestionBanner } from '@/components/wiki/MergeSuggestionBanner'
import { PageTrendView, TrendLegend } from '@/components/wiki/PageTrendView'
import { AffectMapView } from '@/components/insights/AffectMapView'
import { DistortionTrendView } from '@/components/insights/DistortionTrendView'
import { type Theme, moodColorKey, useTheme, useThemedStyles } from '@/theme'
import { useWikiPages, useDismissedPages, useTrendingPages } from '@/hooks/useWiki'
import { useEntries } from '@/hooks/useEntries'
import { useStreakFreezes } from '@/hooks/useStreakFreezes'
import { useGraph, useNodeContext, useNodeDismissals } from '@/hooks/useGraph'
import { useDigest } from '@/hooks/useDigest'
import { dismissNode, type GraphNode, type NodeType } from '@/services/storage/graph'
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
import { CATEGORY_ORDER, categoryKey, categoryLabel } from '@/services/wiki/categories'

const TREND_DAYS = 14

type Tab = 'pages' | 'patterns' | 'map'
type Filter = NodeType | 'all'

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function YouScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('pages')
  const { width, height } = useWindowDimensions()
  const { pages, loading } = useWikiPages()
  const { pages: dismissed } = useDismissedPages()
  const { entries } = useEntries()
  const { frozenDays } = useStreakFreezes()
  const trending = useTrendingPages()
  const { digest, loading: digestLoading } = useDigest()
  const { nodes, edges, refresh } = useGraph(width, height)
  const { dismissals, refresh: refreshHidden } = useNodeDismissals()
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const { context } = useNodeContext(selected)

  // Deep-link from an entry: /graph?focus=<label> — switch to Map and select node.
  const { focus } = useLocalSearchParams<{ focus?: string }>()
  const appliedFocus = useRef<string | null>(null)
  useEffect(() => {
    if (!focus || nodes.length === 0 || appliedFocus.current === focus) return
    const node = nodes.find((n) => n.label.toLowerCase() === focus.toLowerCase())
    if (node) {
      setTab('map')
      setFilter('all')
      setSelected(node)
      appliedFocus.current = focus
    }
  }, [focus, nodes])

  const presentTypes = useMemo(
    () => Array.from(new Set(nodes.map((n) => n.type))),
    [nodes]
  )

  const confirmDrop = (node: GraphNode) => {
    Alert.alert(
      `Remove “${node.label}” from your connections?`,
      'It’ll stop shaping your reflections and won’t reappear from new entries. You can restore it anytime from Hidden.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await dismissNode(node.type, node.label)
            setSelected(null)
            await Promise.all([refresh(), refreshHidden()])
          },
        },
      ]
    )
  }

  // --- Pages segment: wiki category browse  ------------------------
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pages) {
      const k = categoryKey(p.category)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
      key: c,
      label: categoryLabel(c),
      count: counts.get(c) ?? 0,
    }))
  }, [pages])

  // --- Patterns segment: trends + digest  --------------------------
  const now = Date.now()
  const series = useMemo(() => moodByDay(entries, now, TREND_DAYS), [entries, now])
  const affect = useMemo(() => computeAffectMap(entries, now), [entries, now])
  const distortions = useMemo(() => computeDistortionTrend(entries, now), [entries, now])
  const rhythm = useMemo(() => moodByWeekdayTime(entries, now), [entries, now])
  const todayD = new Date(now)
  const weeks = useMemo(
    () => monthMoodGrid(entries, todayD.getFullYear(), todayD.getMonth()),
    [entries, todayD]
  )
  const monthLabel = todayD.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  return (
    <>
      {/* Segment switcher */}
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.md }]}>
        <View style={styles.segments}>
          <Pressable
            accessibilityRole="button"
            style={[styles.segment, tab === 'pages' && styles.segmentActive]}
            onPress={() => setTab('pages')}
            testID="you-tab-pages"
          >
            <Text variant="label" color={tab === 'pages' ? 'primaryText' : 'textSecondary'}>
              Pages
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.segment, tab === 'patterns' && styles.segmentActive]}
            onPress={() => setTab('patterns')}
            testID="you-tab-patterns"
          >
            <Text variant="label" color={tab === 'patterns' ? 'primaryText' : 'textSecondary'}>
              Patterns
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.segment, tab === 'map' && styles.segmentActive]}
            onPress={() => setTab('map')}
            testID="you-tab-map"
          >
            <Text variant="label" color={tab === 'map' ? 'primaryText' : 'textSecondary'}>
              Map
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Pages — wiki category browse */}
      {tab === 'pages' && (
        <Screen padded={false}>
          <FlatList
            data={categories}
            keyExtractor={(c) => c.key}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={Divider}
            ListHeaderComponent={
              <>
                <MoversStrip />
                <MergeSuggestionBanner />
              </>
            }
            ListEmptyComponent={
              !loading ? (
                <EmptyState
                  icon="book-outline"
                  title="No pages yet"
                  message="Write a few entries and they’ll be synthesized here."
                />
              ) : null
            }
            ListFooterComponent={
              dismissed.length > 0 ? (
                <ListRow
                  title="Dropped insights"
                  subtitle={`${dismissed.length} ${dismissed.length === 1 ? 'page' : 'pages'} you set aside`}
                  onPress={() => router.push('/wiki/dismissed')}
                  right={<Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />}
                />
              ) : null
            }
            renderItem={({ item }) => (
              <ListRow
                title={item.label}
                subtitle={`${item.count} ${item.count === 1 ? 'page' : 'pages'}`}
                onPress={() => router.push(`/wiki/category/${item.key}`)}
                right={<Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />}
              />
            )}
          />
        </Screen>
      )}

      {/* Patterns — trends + digest */}
      {tab === 'patterns' && (
        <Screen scroll>
          {digest && !digestLoading && (
            <Card variant="accent" style={styles.digestCard} onPress={() => router.push('/digest')}>
              <Text variant="subtitle" color="accentText">
                Your weekly digest is ready
              </Text>
              <Text variant="caption" color="accentText" style={styles.digestSub}>
                Avg mood {digest.avgMood.toFixed(1)} · {digest.entryCount} entries → View full
              </Text>
            </Card>
          )}

          <Text variant="title" style={styles.h1}>
            Trends
          </Text>

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
                <MoodCalendar
                  weeks={weeks}
                  year={todayD.getFullYear()}
                  month={todayD.getMonth()}
                  frozenDays={frozenDays}
                />
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
        </Screen>
      )}

      {/* Map — graph */}
      {tab === 'map' && (
        <Screen padded={false}>
          <View style={styles.mapTopRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.pillBar}
              contentContainerStyle={styles.pills}
            >
              {(['all', ...presentTypes] as Filter[]).map((f) => (
                <Pressable
                  key={f}
                  accessibilityRole="button"
                  onPress={() => {
                    setFilter(f)
                    setSelected(null)
                  }}
                  style={[styles.pill, filter === f && styles.pillActive]}
                >
                  <Text
                    style={[styles.pillText, filter === f && styles.pillTextActive]}
                  >
                    {f}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {dismissals.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/graph/hidden')}
                style={styles.hiddenLink}
                testID="graph-hidden-link"
              >
                <Text style={styles.hiddenText}>Hidden ({dismissals.length})</Text>
              </Pressable>
            )}
          </View>

          {nodes.length === 0 ? (
            <View style={styles.mapEmpty}>
              <Text style={styles.mapEmptyText}>
                No connections yet — write entries and your emotions, themes, and patterns will
                connect here.
              </Text>
            </View>
          ) : (
            <View style={styles.canvas}>
              <Graph3D
                nodes={nodes}
                edges={edges}
                colors={{
                  emotion: theme.colors.graphEmotion,
                  situation: theme.colors.graphSituation,
                  person: theme.colors.graphPerson,
                  belief: theme.colors.graphBelief,
                  behavior: theme.colors.graphBehavior,
                  distortion: theme.colors.graphDistortion,
                  place: theme.colors.graphPlace,
                  activity: theme.colors.graphActivity,
                }}
                edgeColor={theme.colors.graphEdge}
                labelColor={theme.colors.textSecondary}
                backgroundColor={theme.colors.bg}
                filter={filter}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
            </View>
          )}

          {selected && (
            <View style={styles.nodeCard}>
              <Text style={styles.nodeCardTitle}>{selected.label}</Text>
              <Text style={styles.nodeCardMeta}>
                {selected.type} · appeared {selected.frequency}{' '}
                {selected.frequency === 1 ? 'time' : 'times'}
              </Text>

              <ScrollView style={styles.nodeCardScroll} showsVerticalScrollIndicator={false}>
                {context && context.pages.length > 0 && (
                  <View style={styles.nodeCardSection}>
                    <Text style={styles.nodeCardSectionLabel}>Pages it shaped</Text>
                    {context.pages.map((p) => (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Open the ${p.title} page`}
                        onPress={() => router.push(`/wiki/${p.id}`)}
                        style={styles.nodeLinkRow}
                        testID="graph-node-page"
                      >
                        <Text style={styles.nodeLinkTitle} numberOfLines={1}>
                          {p.title}
                        </Text>
                        <Text style={styles.nodeLinkChevron}>›</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {context && context.entries.length > 0 && (
                  <View style={styles.nodeCardSection}>
                    <Text style={styles.nodeCardSectionLabel}>
                      {context.entries.length === 1 ? 'Entry behind it' : 'Entries behind it'}
                    </Text>
                    {context.entries.slice(0, 6).map((e) => (
                      <Pressable
                        key={e.id}
                        accessibilityRole="button"
                        onPress={() => router.push(`/entries/${e.id}`)}
                        style={styles.nodeLinkRow}
                        testID="graph-node-entry"
                      >
                        <Text style={styles.nodeLinkTitle} numberOfLines={1}>
                          {e.situation.trim() || 'Mood check-in'}
                        </Text>
                        <Text style={styles.nodeLinkDate}>{formatShortDate(e.created_at)}</Text>
                      </Pressable>
                    ))}
                    {context.entries.length > 6 && (
                      <Text style={styles.nodeCardMore}>
                        +{context.entries.length - 6} more
                      </Text>
                    )}
                  </View>
                )}
              </ScrollView>

              <View style={styles.nodeCardActions}>
                <Pressable onPress={() => confirmDrop(selected)} testID="graph-drop">
                  <Text style={styles.nodeCardDrop}>Remove from connections</Text>
                </Pressable>
                <Pressable onPress={() => setSelected(null)}>
                  <Text style={styles.nodeCardClose}>Close</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Screen>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Inline chart components (duplicated from trends.tsx to keep patterns inline)
// ---------------------------------------------------------------------------

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
                style={[
                  styles.bar,
                  { height: `${d.avg == null ? 2 : Math.max(frac * 100, 8)}%`, backgroundColor: color },
                ]}
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

function MoodCalendar({
  weeks,
  year,
  month,
  frozenDays,
}: {
  weeks: MonthCell[][]
  year: number
  month: number
  frozenDays: Set<number>
}) {
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
            const dayIdx =
              cell.day != null
                ? Math.floor(Date.UTC(year, month, cell.day) / 86_400_000)
                : -1
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
    // Segment switcher
    header: { paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md, backgroundColor: t.colors.bg },
    segments: {
      flexDirection: 'row',
      backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radii.pill,
      padding: 2,
    },
    segment: {
      flex: 1,
      paddingVertical: t.spacing.sm,
      alignItems: 'center',
      borderRadius: t.radii.pill - 2,
    },
    segmentActive: { backgroundColor: t.colors.accent },

    // Pages segment
    listContent: {
      paddingHorizontal: t.spacing.xl,
      paddingTop: t.spacing.md,
      paddingBottom: t.spacing['2xl'],
    },

    // Patterns segment
    h1: { marginTop: t.spacing.sm },
    digestCard: { marginTop: t.spacing.md },
    digestSub: { marginTop: t.spacing.xs },
    card: { marginTop: t.spacing.lg },
    cardTitle: { marginBottom: t.spacing.md },
    empty: { marginTop: t.spacing['2xl'] },
    trendRow: { paddingVertical: t.spacing.md },
    chart: { gap: t.spacing.sm },
    bars: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3 },
    barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    bar: { width: '72%', alignSelf: 'center', borderRadius: 3 },
    barLabels: { flexDirection: 'row', gap: 3 },
    barLabel: { flex: 1, textAlign: 'center' },

    // Patterns — calendar
    calRow: { flexDirection: 'row' },
    calHead: { flex: 1, textAlign: 'center', marginBottom: t.spacing.xs },
    cell: { flex: 1, aspectRatio: 1, padding: 2 },
    cellInner: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    cellEmpty: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },

    // Patterns — rhythm
    rhythmRow: { flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.xs },
    rhythmLabel: { width: 72 },
    rhythmHead: { flex: 1, textAlign: 'center' },
    rhythmCellWrap: { flex: 1, padding: 2 },
    rhythmCell: { height: 24, borderRadius: 6 },
    rhythmEmpty: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },
    rhythmMsg: { marginTop: t.spacing.sm },

    // Map segment
    mapTopRow: { flexDirection: 'row', alignItems: 'center', paddingTop: t.spacing.sm },
    pillBar: { flexGrow: 1, maxHeight: 40 },
    hiddenLink: { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.xs },
    hiddenText: {
      color: t.colors.accent,
      fontSize: 13,
      fontFamily: t.fontFamily.uiSemibold,
    },
    pills: { paddingHorizontal: t.spacing.lg, gap: t.spacing.sm, alignItems: 'center' },
    pill: {
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.lg,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.surfaceAlt,
      alignSelf: 'flex-start',
    },
    pillActive: { backgroundColor: t.colors.primary },
    pillText: {
      color: t.colors.textPrimary,
      fontSize: 13,
      fontFamily: t.fontFamily.uiSemibold,
      textTransform: 'capitalize',
    },
    pillTextActive: { color: t.colors.primaryText },
    mapEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing['2xl'] },
    mapEmptyText: {
      color: t.colors.textMuted,
      fontSize: 15,
      fontFamily: t.fontFamily.serifRegular,
      textAlign: 'center',
      lineHeight: 22,
    },
    canvas: { flex: 1, width: '100%' },
    nodeCard: {
      position: 'absolute',
      left: t.spacing.xl,
      right: t.spacing.xl,
      bottom: t.spacing['2xl'],
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.lg,
      padding: t.spacing.lg,
      ...t.shadows.high,
    },
    nodeCardTitle: {
      fontSize: 18,
      fontFamily: t.fontFamily.serifSemibold,
      color: t.colors.textPrimary,
    },
    nodeCardMeta: {
      fontSize: 14,
      fontFamily: t.fontFamily.uiRegular,
      color: t.colors.textSecondary,
      marginTop: t.spacing.xs,
    },
    nodeCardScroll: { maxHeight: 220 },
    nodeCardSection: { marginTop: t.spacing.md },
    nodeCardSectionLabel: {
      fontSize: 12,
      fontFamily: t.fontFamily.uiSemibold,
      color: t.colors.accent,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: t.spacing.xs,
    },
    nodeLinkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: t.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.surfaceAlt,
      gap: t.spacing.md,
    },
    nodeLinkTitle: {
      flex: 1,
      fontSize: 15,
      fontFamily: t.fontFamily.uiRegular,
      color: t.colors.textPrimary,
    },
    nodeLinkChevron: { fontSize: 18, color: t.colors.accent },
    nodeLinkDate: {
      fontSize: 13,
      fontFamily: t.fontFamily.uiRegular,
      color: t.colors.textMuted,
    },
    nodeCardMore: {
      fontSize: 13,
      fontFamily: t.fontFamily.uiRegular,
      color: t.colors.textMuted,
      marginTop: t.spacing.sm,
    },
    nodeCardActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: t.spacing.md,
    },
    nodeCardDrop: { fontSize: 15, fontFamily: t.fontFamily.uiSemibold, color: t.colors.danger },
    nodeCardClose: { fontSize: 15, fontFamily: t.fontFamily.uiSemibold, color: t.colors.accent },
  })
