import { useRouter } from 'expo-router'
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native'
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg'

import { Card, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useDigest } from '@/hooks/useDigest'
import { type MoodPoint } from '@/services/digest/generator'

const ARC_H = 130

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

export default function DigestScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
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
      <Text variant="title">Your week</Text>
      <Text variant="caption" color="textMuted" style={styles.subtitle}>
        {digest.entryCount} entries
      </Text>

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
      </Card>

      <Text variant="label" style={styles.section}>
        Observations
      </Text>
      {digest.observations.map((o, i) => (
        <Card key={i} variant="sunken" style={styles.card}>
          <Text variant="body">{o}</Text>
        </Card>
      ))}

      <Text variant="label" style={styles.section}>
        Pattern
      </Text>
      <Card variant="sunken" style={styles.card}>
        <Text variant="body">{digest.pattern}</Text>
      </Card>

      <Text variant="label" style={styles.section}>
        Correlation
      </Text>
      <Card variant="sunken" style={styles.card}>
        <Text variant="body">{digest.correlation}</Text>
      </Card>

      <Text variant="label" style={styles.section}>
        A question to sit with
      </Text>
      <View style={styles.questionCard}>
        <Text variant="subtitle" color="primaryText">
          {digest.question}
        </Text>
      </View>

      {synthesizing && !digest.synthesis && (
        <View style={styles.synthLoading}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text variant="label" color="accent">
            Looking for themes across your week…
          </Text>
        </View>
      )}

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
    arcCard: { marginTop: t.spacing.lg },
    cardLabel: { marginBottom: t.spacing.sm },
    arcHint: { marginTop: t.spacing.sm },
    section: { marginTop: t.spacing.xl, marginBottom: t.spacing.sm },
    card: { marginBottom: t.spacing.sm },
    questionCard: { backgroundColor: t.colors.primary, borderRadius: t.radii.lg, padding: t.spacing.lg },
    synthLoading: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.xl },
    flagged: { fontStyle: 'italic', marginTop: t.spacing.md },
    quote: { fontStyle: 'italic', textAlign: 'center', marginTop: t.spacing['2xl'] },
    emptyTitle: { marginBottom: t.spacing.sm },
    back: { marginTop: t.spacing.xl, textAlign: 'center' },
  })
