import { useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native'
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg'

import { Card, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useDigest } from '@/hooks/useDigest'
import { type Digest, type EmotionSlice, type MoodPoint } from '@/services/digest/generator'

const ARC_H = 130

// Top feeling stays inline as a scoreboard tile up to this length; longer words
// break out to their own full-width row. 6 = the most that fit a tile before
// wrapping at heading size (measured from the rendered layout).
const INLINE_FEELING_MAX = 6

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function MoodArc({ points, width }: { points: MoodPoint[]; width: number }) {
  const theme = useTheme()
  if (points.length === 0) return null
  const padX = 26
  const padTop = 22
  const padBottom = 18
  const innerW = width - padX - 12
  const innerH = ARC_H - padTop - padBottom
  const yFor = (mood: number) => padTop + innerH - ((mood - 1) / 4) * innerH
  const xFor = (i: number) =>
    padX + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1))
  const xy = points.map((p, i) => ({ x: xFor(i), y: yFor(p.mood), mood: p.mood }))

  return (
    <Svg width={width} height={ARC_H}>
      {/* 1–5 scale: faint gridlines + end labels so a single point is still legible */}
      {[1, 3, 5].map((m) => (
        <Line key={m} x1={padX} y1={yFor(m)} x2={padX + innerW} y2={yFor(m)} stroke={theme.colors.divider} strokeWidth={1} />
      ))}
      <SvgText x={padX - 8} y={yFor(5) + 4} fontSize={10} fill={theme.colors.textMuted} textAnchor="end">5</SvgText>
      <SvgText x={padX - 8} y={yFor(1) + 4} fontSize={10} fill={theme.colors.textMuted} textAnchor="end">1</SvgText>

      {xy.length > 1 && (
        <Polyline points={xy.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={theme.colors.accent} strokeWidth={2} />
      )}
      {xy.map((p, i) => (
        <Circle key={i} testID="mood-point" cx={p.x} cy={p.y} r={5} fill={theme.colors.primary} />
      ))}
      {xy.map((p, i) => (
        <SvgText key={`v${i}`} x={p.x} y={p.y - 10} fontSize={10} fill={theme.colors.textSecondary} textAnchor="middle">
          {p.mood.toFixed(1)}
        </SvgText>
      ))}
    </Svg>
  )
}

/** A single number-forward tile in the scoreboard row. */
function StatTile({ value, label, tone }: { value: string; label: string; tone?: 'up' | 'down' }) {
  const styles = useThemedStyles(makeStyles)
  const color = tone === 'up' ? 'success' : tone === 'down' ? 'danger' : 'textPrimary'
  return (
    <Card variant="sunken" style={styles.tile}>
      <Text variant="heading" color={color}>
        {value}
      </Text>
      <Text variant="caption" color="textMuted" style={styles.tileLabel}>
        {label}
      </Text>
    </Card>
  )
}

/** Horizontal emotion-mix bars, scaled to the most frequent feeling. */
function EmotionMix({ mix }: { mix: EmotionSlice[] }) {
  const styles = useThemedStyles(makeStyles)
  const top = mix.slice(0, 6)
  const max = top[0]?.count ?? 1
  return (
    <View style={styles.mix}>
      {top.map((s) => (
        <View key={s.label} style={styles.mixRow}>
          <Text variant="caption" color="textSecondary" style={styles.mixLabel} numberOfLines={1}>
            {cap(s.label)}
          </Text>
          <View style={styles.mixTrack}>
            <View style={[styles.mixFill, { width: `${(s.count / max) * 100}%` }]} />
          </View>
          <Text variant="caption" color="textMuted" style={styles.mixCount}>
            {s.count}
          </Text>
        </View>
      ))}
    </View>
  )
}

function deltaLabel(delta: number): { value: string; tone: 'up' | 'down' | undefined } {
  const rounded = Math.round(delta * 10) / 10
  if (rounded > 0) return { value: `↑${rounded.toFixed(1)}`, tone: 'up' }
  if (rounded < 0) return { value: `↓${Math.abs(rounded).toFixed(1)}`, tone: 'down' }
  return { value: '±0.0', tone: undefined }
}

function dateRange(start: number, end: number): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${new Date(start).toLocaleDateString(undefined, opts)} – ${new Date(end).toLocaleDateString(undefined, opts)}`
}

function Dashboard({
  digest,
  width,
  synthesizing,
}: {
  digest: Digest
  width: number
  synthesizing: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const delta = digest.moodDelta == null ? null : deltaLabel(digest.moodDelta)
  // Hybrid placement for the top feeling: a short word fits the number-sized
  // tile (the screenshot showed 6 chars fit before wrapping), a longer one gets
  // its own full-width row so it reads at full size instead of wrapping.
  const feeling = digest.emotionMix[0] ? cap(digest.emotionMix[0].label) : null
  const feelingInline = feeling != null && feeling.length <= INLINE_FEELING_MAX

  return (
    <>
      <Text variant="title">Your week</Text>
      <Text variant="caption" color="textMuted" style={styles.subtitle}>
        {dateRange(digest.weekStart, digest.weekEnd)} · {digest.entryCount} entries · {digest.dayCount}{' '}
        {digest.dayCount === 1 ? 'day' : 'days'}
      </Text>

      {synthesizing && !digest.synthesis && (
        <View style={styles.synthBanner}>
          <ActivityIndicator color={theme.colors.accent} size="small" />
          <Text variant="label" color="accent">
            Looking for themes across your week…
          </Text>
        </View>
      )}

      <View style={styles.tiles}>
        <StatTile value={digest.avgMood.toFixed(1)} label="avg mood" />
        {delta && <StatTile value={delta.value} label="vs last week" tone={delta.tone} />}
        {feeling && feelingInline && <StatTile value={feeling} label="top feeling" />}
      </View>

      {/* A long feeling ("Disappointment") gets its own full-width row so it
          reads at full size instead of cramming or wrapping in a tile. */}
      {feeling && !feelingInline && (
        <Card variant="sunken" style={styles.topFeeling}>
          <Text variant="caption" color="textMuted">
            top feeling
          </Text>
          <Text variant="heading" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {feeling}
          </Text>
        </Card>
      )}

      <Card variant="sunken" style={styles.arcCard}>
        <Text variant="label" color="accent" style={styles.cardLabel}>
          Mood (1–5)
        </Text>
        <MoodArc points={digest.moodArc} width={width - 48 - 32} />
        {digest.moodArc.length === 1 && (
          <Text variant="caption" color="textMuted" style={styles.arcHint}>
            One day so far — the line fills in as you journal across more days.
          </Text>
        )}
        {digest.brightest && digest.toughest && (
          <Text variant="caption" color="textSecondary" style={styles.extremes}>
            ☀ Brightest {digest.brightest.weekday} ({digest.brightest.mood.toFixed(1)}) · 🌧 Toughest{' '}
            {digest.toughest.weekday} ({digest.toughest.mood.toFixed(1)})
          </Text>
        )}
      </Card>

      {digest.emotionMix.length > 0 && (
        <>
          <Text variant="label" style={styles.section}>
            Emotions this week
          </Text>
          <Card variant="sunken" style={styles.card}>
            <EmotionMix mix={digest.emotionMix} />
          </Card>
        </>
      )}

      <Text variant="label" style={styles.section}>
        What stood out
      </Text>
      <Card variant="sunken" style={styles.card}>
        <Text variant="body">{digest.pattern}</Text>
      </Card>
      <Card variant="sunken" style={styles.card}>
        <Text variant="body">{digest.correlation}</Text>
      </Card>

      {digest.moodBlindSpot && (
        <Card variant="sunken" style={styles.card}>
          <Text variant="label" color="accent" style={styles.cardLabel}>
            Mood check
          </Text>
          <Text variant="body">{digest.moodBlindSpot.message}</Text>
        </Card>
      )}

      {digest.selfCriticism && (
        <Card variant="sunken" style={styles.card}>
          <Text variant="label" color="accent" style={styles.cardLabel}>
            A gentler read
          </Text>
          <Text variant="body">{digest.selfCriticism.message}</Text>
        </Card>
      )}
    </>
  )
}

export default function DigestScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const styles = useThemedStyles(makeStyles)
  const { digest, loading, synthesizing } = useDigest()

  if (loading && !digest) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">
            Preparing your week…
          </Text>
        </View>
      </Screen>
    )
  }

  if (!digest) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="heading" style={styles.emptyTitle}>
            No digest yet
          </Text>
          <Text variant="body" color="textMuted" style={styles.centerText}>
            Your first weekly digest appears once you’ve journaled through a week.
          </Text>
          <Text variant="label" color="accent" style={styles.back} onPress={() => router.replace('/')}>
            ← Home
          </Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen scroll>
      <Dashboard digest={digest} width={width} synthesizing={synthesizing} />

      <Text variant="label" style={styles.section}>
        A question to sit with
      </Text>
      <View style={styles.questionCard}>
        <Text variant="subtitle" color="primaryText">
          {digest.question}
        </Text>
      </View>

      {digest.synthesis && (
        <>
          {digest.synthesis.themes.length > 0 && (
            <>
              <Text variant="label" style={styles.section}>
                Themes
              </Text>
              {digest.synthesis.themes.map((t, i) => (
                <Card key={i} variant="sunken" style={styles.card}>
                  <Text variant="body">{t}</Text>
                </Card>
              ))}
            </>
          )}

          {digest.synthesis.patterns.length > 0 && (
            <>
              <Text variant="label" style={styles.section}>
                Patterns
              </Text>
              {digest.synthesis.patterns.map((p, i) => (
                <Card key={i} variant="sunken" style={styles.card}>
                  <Text variant="body">{p}</Text>
                </Card>
              ))}
            </>
          )}

          {digest.synthesis.openQuestions.length > 0 && (
            <>
              <Text variant="label" style={styles.section}>
                Open questions
              </Text>
              {digest.synthesis.openQuestions.map((q, i) => (
                <Card key={i} variant="sunken" style={styles.card}>
                  <Text variant="body">{q}</Text>
                </Card>
              ))}
            </>
          )}

          {digest.synthesis.flaggedClaims.length > 0 && (
            <Text variant="caption" color="textMuted" style={styles.flagged}>
              Set aside — not enough in your entries to support: {digest.synthesis.flaggedClaims.join('; ')}
            </Text>
          )}
        </>
      )}

      <Text variant="body" color="textSecondary" style={styles.quote}>
        “{digest.quote}”
      </Text>

      <Text variant="label" color="accent" style={styles.back} onPress={() => router.replace('/')}>
        ← Home
      </Text>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm },
    centerText: { textAlign: 'center' },
    subtitle: { marginTop: t.spacing.xs },
    tiles: { flexDirection: 'row', gap: t.spacing.sm, marginTop: t.spacing.lg },
    tile: { flex: 1, alignItems: 'center' },
    topFeeling: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: t.spacing.sm,
    },
    tileLabel: { marginTop: t.spacing.xs, textAlign: 'center' },
    arcCard: { marginTop: t.spacing.lg },
    cardLabel: { marginBottom: t.spacing.sm },
    arcHint: { marginTop: t.spacing.sm },
    extremes: { marginTop: t.spacing.md },
    section: { marginTop: t.spacing.xl, marginBottom: t.spacing.sm },
    card: { marginBottom: t.spacing.sm },
    mix: { gap: t.spacing.sm },
    mixRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
    mixLabel: { width: 76 },
    mixTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: t.colors.divider, overflow: 'hidden' },
    mixFill: { height: '100%', borderRadius: 5, backgroundColor: t.colors.accent },
    mixCount: { width: 20, textAlign: 'right' },
    questionCard: { backgroundColor: t.colors.primary, borderRadius: t.radii.lg, padding: t.spacing.lg },
    synthBanner: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.md },
    flagged: { fontStyle: 'italic', marginTop: t.spacing.md },
    quote: { fontStyle: 'italic', textAlign: 'center', marginTop: t.spacing['2xl'] },
    emptyTitle: { marginBottom: t.spacing.sm },
    back: { marginTop: t.spacing.xl, textAlign: 'center' },
  })
