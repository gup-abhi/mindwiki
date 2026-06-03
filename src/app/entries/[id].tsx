import { useLocalSearchParams, useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { useEntry } from '@/hooks/useEntries'

const MOOD_LABELS = ['', 'Very low', 'Low', 'Okay', 'Good', 'Great']

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  )
}

export default function EntryDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { entry, loading } = useEntry(id)

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    )
  }

  if (!entry) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>That entry couldn’t be found.</Text>
        <Text style={styles.back} onPress={() => router.back()}>
          ← Back
        </Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>
      <Text style={styles.date}>{formatDate(entry.created_at)}</Text>
      <Text style={styles.mood}>
        Mood: {entry.mood}/5 · {MOOD_LABELS[entry.mood] ?? ''}
      </Text>

      <Field label="Situation" value={entry.situation} />
      <Field label="Thought" value={entry.thought} />
      {entry.behavior ? <Field label="Behaviour" value={entry.behavior} /> : null}
      {entry.closing_note ? <Field label="Closing note" value={entry.closing_note} /> : null}

      {entry.emotion ? (
        <View style={styles.tags}>
          <Text style={styles.tagsText}>
            {entry.emotion}
            {entry.distortion && entry.distortion !== 'none' ? ` · ${entry.distortion}` : ''}
            {entry.mood_score != null ? ` · mood ${entry.mood_score}` : ''}
          </Text>
        </View>
      ) : null}

      <Text style={styles.back} onPress={() => router.back()}>
        ← Back
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 24, paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: '#fff' },
  muted: { fontSize: 15, color: '#999' },
  date: { fontSize: 14, color: '#999' },
  mood: { fontSize: 16, color: '#7a7ad0', fontWeight: '600', marginTop: 4 },
  field: { marginTop: 22 },
  fieldLabel: { fontSize: 13, color: '#7a7ad0', fontWeight: '700', marginBottom: 6 },
  fieldValue: { fontSize: 17, color: '#1a1a2e', lineHeight: 25 },
  tags: { marginTop: 24, backgroundColor: '#f2f2f7', borderRadius: 10, padding: 12 },
  tagsText: { fontSize: 14, color: '#666' },
  back: { fontSize: 16, color: '#7a7ad0', fontWeight: '600', marginTop: 36, textAlign: 'center' },
})
