import { useRouter } from 'expo-router'
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg'

import { useDigest } from '@/hooks/useDigest'
import { type MoodPoint } from '@/services/digest/generator'

const ARC_H = 130

function MoodArc({ points, width }: { points: MoodPoint[]; width: number }) {
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
        <Line key={m} x1={padX} y1={yFor(m)} x2={padX + innerW} y2={yFor(m)} stroke="#e6e6f0" strokeWidth={1} />
      ))}
      <SvgText x={padX - 8} y={yFor(5) + 4} fontSize={10} fill="#aaa" textAnchor="end">5</SvgText>
      <SvgText x={padX - 8} y={yFor(1) + 4} fontSize={10} fill="#aaa" textAnchor="end">1</SvgText>

      {xy.length > 1 && (
        <Polyline points={xy.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#7a7ad0" strokeWidth={2} />
      )}
      {xy.map((p, i) => (
        <Circle key={i} testID="mood-point" cx={p.x} cy={p.y} r={5} fill="#1a1a2e" />
      ))}
      {xy.map((p, i) => (
        <SvgText key={`v${i}`} x={p.x} y={p.y - 10} fontSize={10} fill="#666" textAnchor="middle">
          {p.mood.toFixed(1)}
        </SvgText>
      ))}
    </Svg>
  )
}

export default function DigestScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { digest, loading, synthesizing } = useDigest()

  if (loading && !digest) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Preparing your week…</Text>
      </View>
    )
  }

  if (!digest) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No digest yet</Text>
        <Text style={styles.muted}>
          Your first weekly digest appears once you’ve journaled through a week.
        </Text>
        <Text style={styles.back} onPress={() => router.replace('/')}>
          ← Home
        </Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>
      <Text style={styles.title}>Your week</Text>
      <Text style={styles.subtitle}>{digest.entryCount} entries</Text>

      <View style={styles.arcCard}>
        <Text style={styles.cardLabel}>Mood (1–5)</Text>
        <MoodArc points={digest.moodArc} width={width - 48 - 32} />
        {digest.moodArc.length === 1 && (
          <Text style={styles.arcHint}>One day so far — the line fills in as you journal across more days.</Text>
        )}
      </View>

      <Text style={styles.section}>Observations</Text>
      {digest.observations.map((o, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.cardText}>{o}</Text>
        </View>
      ))}

      <Text style={styles.section}>Pattern</Text>
      <View style={styles.card}>
        <Text style={styles.cardText}>{digest.pattern}</Text>
      </View>

      <Text style={styles.section}>Correlation</Text>
      <View style={styles.card}>
        <Text style={styles.cardText}>{digest.correlation}</Text>
      </View>

      <Text style={styles.section}>A question to sit with</Text>
      <View style={styles.questionCard}>
        <Text style={styles.questionText}>{digest.question}</Text>
      </View>

      {synthesizing && !digest.synthesis && (
        <View style={styles.synthLoading}>
          <ActivityIndicator color="#7a7ad0" />
          <Text style={styles.synthLoadingText}>Looking for themes across your week…</Text>
        </View>
      )}

      {digest.synthesis && (
        <>
          {digest.synthesis.themes.length > 0 && (
            <>
              <Text style={styles.section}>Themes</Text>
              {digest.synthesis.themes.map((t, i) => (
                <View key={i} style={styles.card}>
                  <Text style={styles.cardText}>{t}</Text>
                </View>
              ))}
            </>
          )}

          {digest.synthesis.patterns.length > 0 && (
            <>
              <Text style={styles.section}>Patterns</Text>
              {digest.synthesis.patterns.map((p, i) => (
                <View key={i} style={styles.card}>
                  <Text style={styles.cardText}>{p}</Text>
                </View>
              ))}
            </>
          )}

          {digest.synthesis.openQuestions.length > 0 && (
            <>
              <Text style={styles.section}>Open questions</Text>
              {digest.synthesis.openQuestions.map((q, i) => (
                <View key={i} style={styles.card}>
                  <Text style={styles.cardText}>{q}</Text>
                </View>
              ))}
            </>
          )}

          {digest.synthesis.flaggedClaims.length > 0 && (
            <Text style={styles.flagged}>
              Set aside — not enough in your entries to support: {digest.synthesis.flaggedClaims.join('; ')}
            </Text>
          )}
        </>
      )}

      <Text style={styles.quote}>“{digest.quote}”</Text>

      <Text style={styles.back} onPress={() => router.replace('/')}>
        ← Home
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 24, paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: '#fff' },
  title: { fontSize: 30, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 15, color: '#999', marginTop: 4 },
  arcCard: { backgroundColor: '#f7f7fb', borderRadius: 14, padding: 16, marginTop: 20 },
  cardLabel: { fontSize: 13, color: '#7a7ad0', fontWeight: '600', marginBottom: 8 },
  arcHint: { fontSize: 12, color: '#999', marginTop: 6, lineHeight: 17 },
  section: { fontSize: 14, fontWeight: '700', color: '#1a1a2e', marginTop: 24, marginBottom: 8 },
  card: { backgroundColor: '#f7f7fb', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardText: { fontSize: 15, color: '#333', lineHeight: 21 },
  questionCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 18 },
  questionText: { fontSize: 17, color: '#fff', lineHeight: 24, fontWeight: '600' },
  synthLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 24 },
  synthLoadingText: { fontSize: 14, color: '#7a7ad0', fontWeight: '600' },
  flagged: { fontSize: 13, color: '#999', fontStyle: 'italic', marginTop: 12, lineHeight: 19 },
  quote: { fontSize: 15, color: '#666', fontStyle: 'italic', textAlign: 'center', marginTop: 28, lineHeight: 22 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  muted: { fontSize: 15, color: '#999', textAlign: 'center', lineHeight: 22 },
  back: { fontSize: 16, color: '#7a7ad0', fontWeight: '600', marginTop: 28, textAlign: 'center' },
})
