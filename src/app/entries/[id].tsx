import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { Card, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
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
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.field}>
      <Text variant="label" color="accent" style={styles.fieldLabel}>
        {label}
      </Text>
      <Text variant="body" style={styles.fieldValue}>
        {value}
      </Text>
    </View>
  )
}

export default function EntryDetailScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { entry, loading } = useEntry(id)

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">
            Loading…
          </Text>
        </View>
      </Screen>
    )
  }

  if (!entry) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">
            That entry couldn’t be found.
          </Text>
          <Text variant="label" color="accent" style={styles.back} onPress={() => router.back()}>
            ← Back
          </Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen scroll>
      <Text variant="caption" color="textMuted">
        {formatDate(entry.created_at)}
      </Text>
      <Text variant="bodyStrong" color="accent" style={styles.mood}>
        Mood: {entry.mood}/5 · {MOOD_LABELS[entry.mood] ?? ''}
      </Text>

      <Field label="Situation" value={entry.situation} />
      <Field label="Thought" value={entry.thought} />
      {entry.behavior ? <Field label="Behaviour" value={entry.behavior} /> : null}
      {entry.closing_note ? <Field label="Closing note" value={entry.closing_note} /> : null}

      {entry.emotion ? (
        <Card variant="sunken" style={styles.tags}>
          <Text variant="caption" color="textSecondary">
            {entry.emotion}
            {entry.distortion && entry.distortion !== 'none' ? ` · ${entry.distortion}` : ''}
            {entry.mood_score != null ? ` · mood ${entry.mood_score}` : ''}
          </Text>
        </Card>
      ) : null}

      <Text variant="label" color="accent" style={styles.back} onPress={() => router.back()}>
        ← Back
      </Text>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
    mood: { marginTop: t.spacing.xs },
    field: { marginTop: t.spacing.xl },
    fieldLabel: { marginBottom: t.spacing.xs },
    fieldValue: { lineHeight: 25 },
    tags: { marginTop: t.spacing.xl },
    back: { marginTop: t.spacing['2xl'], textAlign: 'center' },
  })
