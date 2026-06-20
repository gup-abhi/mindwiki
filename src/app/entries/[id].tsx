import { useMemo } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Screen, Text } from '@/components/ui'
import { type Theme, moodColorKey, moodLabel, useThemedStyles } from '@/theme'
import { useEntries, useEntry } from '@/hooks/useEntries'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** A colored mood dot + its label ("Good"), reading the same scale as the list. */
function MoodChip({ mood }: { mood: number }) {
  const styles = useThemedStyles((t) =>
    StyleSheet.create({
      row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.sm },
      dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors[moodColorKey(mood)] },
    })
  )
  return (
    <View style={styles.row}>
      <View style={styles.dot} />
      <Text variant="label" color="textSecondary">
        {moodLabel(mood)}
      </Text>
    </View>
  )
}

function Section({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.section}>
      <Text variant="label" color="accent" style={styles.sectionLabel}>
        {label}
      </Text>
      <Text variant="body" style={styles.prose}>
        {value}
      </Text>
    </View>
  )
}

function Tag({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.tag}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
    </View>
  )
}

export default function EntryDetailScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { entry, loading } = useEntry(id)
  const { entries } = useEntries()

  // Neighbours for prev/next, from the newest-first list. Older sits at a higher
  // index; newer at a lower one.
  const { older, newer } = useMemo(() => {
    const i = entries.findIndex((e) => e.id === id)
    if (i === -1) return { older: undefined, newer: undefined }
    return { older: entries[i + 1], newer: entries[i - 1] }
  }, [entries, id])

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
          <Text variant="label" color="accent" onPress={() => router.back()}>
            ← Back
          </Text>
        </View>
      </Screen>
    )
  }

  const tags = [
    entry.emotion,
    entry.distortion && entry.distortion !== 'none' ? entry.distortion : null,
    entry.topic,
  ].filter((t): t is string => !!t && t !== 'none')

  return (
    <Screen scroll>
      <Text variant="label" color="accent" onPress={() => router.back()}>
        ← Back
      </Text>

      <Text variant="caption" color="textMuted" style={styles.date}>
        {formatDate(entry.created_at)}
      </Text>
      <MoodChip mood={entry.mood} />

      <Text variant="body" style={[styles.prose, styles.situation]}>
        {entry.situation}
      </Text>
      {entry.thought ? <Section label="The thought behind this" value={entry.thought} /> : null}
      {entry.behavior ? <Section label="Behaviour" value={entry.behavior} /> : null}
      {entry.closing_note ? <Section label="Closing note" value={entry.closing_note} /> : null}

      {tags.length > 0 ? (
        <View style={styles.tags}>
          {tags.map((t) => (
            <Tag key={t} label={t} />
          ))}
        </View>
      ) : null}

      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          disabled={!older}
          onPress={() => older && router.replace(`/entries/${older.id}`)}
        >
          <Text variant="label" color={older ? 'accent' : 'textMuted'}>
            ← Older
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!newer}
          onPress={() => newer && router.replace(`/entries/${newer.id}`)}
        >
          <Text variant="label" color={newer ? 'accent' : 'textMuted'}>
            Newer →
          </Text>
        </Pressable>
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
    date: { marginTop: t.spacing.xl },
    prose: { lineHeight: 25 },
    situation: { marginTop: t.spacing.xl },
    section: { marginTop: t.spacing.xl },
    sectionLabel: { marginBottom: t.spacing.xs },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: t.spacing['2xl'] },
    tag: {
      borderRadius: t.radii.pill,
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.md,
      backgroundColor: t.colors.surfaceAlt,
    },
    nav: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: t.spacing['2xl'],
      paddingTop: t.spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
  })
