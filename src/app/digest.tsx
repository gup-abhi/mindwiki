import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Svg, { Circle, Polyline } from 'react-native-svg'

import { useDigest } from '@/hooks/useDigest'
import { type MoodPoint } from '@/services/digest/generator'

const ARC_H = 120

function MoodArc({ points, width }: { points: MoodPoint[]; width: number }) {
  if (points.length === 0) return null
  const pad = 16
  const innerW = width - pad * 2
  const innerH = ARC_H - pad * 2
  // x evenly spaced; y maps mood 1..5 to bottom..top.
  const xy = points.map((p, i) => {
    const x = pad + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1))
    const y = pad + innerH - ((p.mood - 1) / 4) * innerH
    return { x, y }
  })
  return (
    <Svg width={width} height={ARC_H}>
      <Polyline
        points={xy.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#7a7ad0"
        strokeWidth={2}
      />
      {xy.map((p, i) => (
        <Circle key={i} testID="mood-point" cx={p.x} cy={p.y} r={4} fill="#1a1a2e" />
      ))}
    </Svg>
  )
}

export default function DigestScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { digest, loading } = useDigest()

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
        <Text style={styles.cardLabel}>Mood</Text>
        <MoodArc points={digest.moodArc} width={width - 48 - 32} />
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
  section: { fontSize: 14, fontWeight: '700', color: '#1a1a2e', marginTop: 24, marginBottom: 8 },
  card: { backgroundColor: '#f7f7fb', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardText: { fontSize: 15, color: '#333', lineHeight: 21 },
  questionCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 18 },
  questionText: { fontSize: 17, color: '#fff', lineHeight: 24, fontWeight: '600' },
  quote: { fontSize: 15, color: '#666', fontStyle: 'italic', textAlign: 'center', marginTop: 28, lineHeight: 22 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  muted: { fontSize: 15, color: '#999', textAlign: 'center', lineHeight: 22 },
  back: { fontSize: 16, color: '#7a7ad0', fontWeight: '600', marginTop: 28, textAlign: 'center' },
})
