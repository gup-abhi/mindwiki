import { useMemo } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Screen, Text } from '@/components/ui'
import { type Theme, moodColorKey, moodLabel, useThemedStyles } from '@/theme'
import { useEntries, useEntry } from '@/hooks/useEntries'
import { useEntryLineage } from '@/hooks/useWiki'

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

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

/** A tag that grew into a wiki page — tappable, opens the page. */
function PageTag({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the ${label} page`}
      onPress={onPress}
      style={[styles.tag, styles.tagLink]}
    >
      <Text variant="caption" color="accentText">
        {label} ›
      </Text>
    </Pressable>
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

  // The wiki pages this entry shaped, and other entries on the same theme.
  const lineage = useEntryLineage(entry)
  const related = useMemo(() => {
    if (!entry) return []
    return entries
      .filter(
        (e) =>
          e.id !== entry.id &&
          ((!!entry.emotion && e.emotion === entry.emotion) ||
            (!!entry.topic && e.topic === entry.topic) ||
            (!!entry.topic2 && e.topic === entry.topic2) ||
            (!!entry.topic && e.topic2 === entry.topic) ||
            (!!entry.topic2 && e.topic2 === entry.topic2))
      )
      .slice(0, 3)
  }, [entries, entry])

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

  // emotion / distortion / topic can coincide (the model may tag the same word as
  // both the feeling and the theme). De-dupe case-insensitively so a label shows
  // as one pill — and so the key={label} in tags.map below can't collide.
  const seenTags = new Set<string>()
  const tags = [
    entry.emotion,
    entry.distortion && entry.distortion !== 'none' ? entry.distortion : null,
    entry.topic,
    entry.topic2,
  ].filter((t): t is string => {
    if (!t || t === 'none') return false
    const key = t.toLowerCase()
    if (seenTags.has(key)) return false
    seenTags.add(key)
    return true
  })

  // A tag often grew into a wiki page (same label) — so the old "Shaped these
  // pages" list just repeated the tags. Instead, make each tag that maps to a
  // live page tappable, and surface any pages the entry shaped that aren't
  // already a tag (e.g. people/places) as extra links. One row, no duplication.
  const pageByLabel = new Map(lineage.map((p) => [p.title.trim().toLowerCase(), p]))
  const taggedLabels = new Set(tags.map((t) => t.toLowerCase()))
  const extraPages = lineage.filter((p) => !taggedLabels.has(p.title.trim().toLowerCase()))
  const hasLinks = lineage.length > 0

  // Deep link into the connections view, focused on the entry's primary concept
  // (its theme, else its emotion) — only a node that recurred is focused there.
  const graphFocus = entry.topic?.trim() || entry.emotion?.trim() || null

  return (
    <Screen scroll>
      <Text variant="label" color="accent" onPress={() => router.back()}>
        ← Back
      </Text>

      <Text variant="caption" color="textMuted" style={styles.date}>
        {formatDate(entry.created_at)}
      </Text>
      <MoodChip mood={entry.mood} />

      {entry.situation.trim() ? (
        <Text variant="body" style={[styles.prose, styles.situation]}>
          {entry.situation}
        </Text>
      ) : !entry.thought ? (
        <Text variant="body" color="textMuted" style={styles.situation}>
          A quick mood check-in — no note added.
        </Text>
      ) : null}
      {entry.thought ? <Section label="The thought behind this" value={entry.thought} /> : null}
      {entry.behavior ? <Section label="Behaviour" value={entry.behavior} /> : null}
      {entry.closing_note ? <Section label="Closing note" value={entry.closing_note} /> : null}

      {tags.length > 0 || extraPages.length > 0 ? (
        <View style={styles.tags}>
          {tags.map((t) => {
            const page = pageByLabel.get(t.toLowerCase())
            return page ? (
              <PageTag key={t} label={t} onPress={() => router.push(`/wiki/${page.id}`)} />
            ) : (
              <Tag key={t} label={t} />
            )
          })}
          {extraPages.map((p) => (
            <PageTag key={p.id} label={p.title} onPress={() => router.push(`/wiki/${p.id}`)} />
          ))}
        </View>
      ) : null}
      {hasLinks ? (
        <Text variant="caption" color="textMuted" style={styles.linkHint}>
          Tap a highlighted tag to open the page it shaped.
        </Text>
      ) : null}

      {graphFocus ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See ${graphFocus} in your connections`}
          onPress={() => router.push({ pathname: '/graph', params: { focus: graphFocus } })}
          style={styles.graphLink}
          testID="entry-graph-link"
        >
          <Text variant="label" color="accent">
            See “{graphFocus}” in your connections ›
          </Text>
        </Pressable>
      ) : null}

      {related.length > 0 ? (
        <View style={styles.linkSection}>
          <Text variant="label" color="accent" style={styles.sectionLabel}>
            Related entries
          </Text>
          {related.map((e) => (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              onPress={() => router.push(`/entries/${e.id}`)}
              style={styles.linkRow}
            >
              <Text variant="body" numberOfLines={1}>
                {e.situation}
              </Text>
              <Text variant="caption" color="textMuted">
                {formatShortDate(e.created_at)}
              </Text>
            </Pressable>
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
    tagLink: { backgroundColor: t.colors.accentMuted },
    linkHint: { marginTop: t.spacing.sm },
    graphLink: { marginTop: t.spacing.lg },
    linkSection: { marginTop: t.spacing['2xl'] },
    linkRow: { paddingVertical: t.spacing.sm },
    nav: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: t.spacing['2xl'],
      paddingTop: t.spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.border,
    },
  })
