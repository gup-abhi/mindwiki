import { useMemo } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Card, Chip, Divider, IconButton, ListRow, Screen, Text } from '@/components/ui'
import { type Theme, moodColorKey, moodLabel, useTheme, useThemedStyles } from '@/theme'
import { useEntries, useEntry, useEntryNeighbors } from '@/hooks/useEntries'
import { useGraph } from '@/hooks/useGraph'
import { useEntryLineage, useWikiPages } from '@/hooks/useWiki'
import { entryPreview } from '@/lib/entry-display'
import { type Entry } from '@/services/storage/entries'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function MoodMeta({ mood }: { mood: number }) {
  const styles = useThemedStyles((t) => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors[moodColorKey(mood)] },
  }))
  return (
    <View style={styles.row} accessibilityLabel={`Mood: ${moodLabel(mood)}`}>
      <View style={styles.dot} accessibilityElementsHidden importantForAccessibility="no" />
      <Text variant="label" color="textSecondary">{moodLabel(mood)}</Text>
    </View>
  )
}

function ReflectionField({ label, value, quote = false, compact = false }: { label: string; value: string; quote?: boolean; compact?: boolean }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={compact ? styles.compactField : styles.field}>
      <Text variant="label" color="textSecondary">{label}</Text>
      <Text variant="body" style={quote ? styles.quote : undefined}>{value}</Text>
    </View>
  )
}

function AuthoredReflection({ entry }: { entry: Entry }) {
  const styles = useThemedStyles(makeStyles)
  const situation = entry.situation.trim()
  const thought = entry.thought.trim()
  const behavior = entry.behavior?.trim() ?? ''
  const closingNote = entry.closing_note?.trim() ?? ''
  const moodOnly = !situation && !thought

  return (
    <View testID="entry-remember-section">
      {situation ? <Text variant="body" style={styles.situation}>{situation}</Text> : null}
      {moodOnly ? (
        <Text variant="body" color="textMuted" style={styles.situation}>
          A quick mood check-in — no note added.
        </Text>
      ) : null}
      {thought ? <ReflectionField label="The thought behind this" value={thought} quote /> : null}
      {behavior ? <ReflectionField label="Behaviour" value={behavior} /> : null}
      {closingNote ? <ReflectionField label="Closing note" value={closingNote} /> : null}
    </View>
  )
}

function LocalReflection({
  entry,
  pages,
  graphNodes,
}: {
  entry: Entry
  pages: ReturnType<typeof useWikiPages>['pages']
  graphNodes: { id: string; label: string }[]
}) {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const written = entry.situation.trim() !== '' || entry.thought.trim() !== ''
  if (!written) return null

  const labels = [entry.emotion, entry.distortion, entry.topic, entry.topic2].filter(
    (value): value is string => !!value && value.trim() !== '' && value.trim().toLowerCase() !== 'none'
  )
  const seen = new Set<string>()
  const uniqueLabels = labels.filter((value) => {
    const key = value.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (entry.tagged_at == null) {
    return (
      <View testID="entry-tagging-status" accessibilityLiveRegion="polite">
        <Text variant="label" color="accent">Private reflection in progress</Text>
        <Text variant="caption" color="textMuted" style={styles.statusText}>
          Your entry is saved. MindWiki is noticing themes on this device.
        </Text>
      </View>
    )
  }

  const themes = [entry.topic, entry.topic2]
    .filter((value): value is string => !!value && value.trim() !== '' && value.trim().toLowerCase() !== 'none')
    .filter((value, index, values) => values.findIndex((candidate) => candidate.trim().toLowerCase() === value.trim().toLowerCase()) === index)
    .filter((value) => {
      const key = value.trim().toLowerCase()
      return key !== entry.emotion?.trim().toLowerCase() && key !== entry.distortion?.trim().toLowerCase()
    })
  if (uniqueLabels.length === 0 && graphNodes.length === 0) return null
  return (
    <Card variant="sunken" style={styles.localCard} testID="entry-local-reflection">
      <Text variant="subtitle">MindWiki’s local reflection</Text>
      {entry.emotion && entry.emotion.trim() !== '' && entry.emotion.trim().toLowerCase() !== 'none' ? (
        <ReflectionField label="MindWiki noticed" value={entry.emotion} compact />
      ) : null}
      {entry.distortion && entry.distortion.trim() !== '' && entry.distortion.trim().toLowerCase() !== 'none' ? (
        <ReflectionField label="Possible thinking pattern" value={entry.distortion} compact />
      ) : null}
      {themes.length > 0 ? (
        <View style={styles.compactField}>
          <Text variant="label" color="textSecondary">Themes</Text>
          <View style={styles.badgeRow}>
            {themes.map((theme) => {
              const page = pages.find((candidate) => candidate.title.trim().toLowerCase() === theme.trim().toLowerCase())
              return (
                <Chip
                  key={theme}
                  label={theme}
                  onPress={page ? () => router.push(`/wiki/${page.id}`) : undefined}
                  testID={page ? 'entry-theme-page-link' : `entry-theme-${theme}`}
                />
              )
            })}
          </View>
        </View>
      ) : null}
      {graphNodes.length > 0 ? (
        <View style={styles.compactField} testID="entry-graph-links">
          <Text variant="label" color="textSecondary">In your connections</Text>
          <View style={styles.badgeRow}>
            {graphNodes.map((node) => (
              <Chip
                key={node.id}
                label={node.label}
                onPress={() => router.push({
                  pathname: '/(tabs)/you',
                  params: { nodeId: node.id, returnEntryId: entry.id },
                })}
                testID={`entry-graph-link-${node.id}`}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Text variant="caption" color="textMuted" style={styles.provenance}>Processed privately on this device.</Text>
    </Card>
  )
}

function KnowledgeTrail({
  entry,
  lineage,
}: {
  entry: Entry
  lineage: ReturnType<typeof useEntryLineage>
}) {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const written = entry.situation.trim() !== '' || entry.thought.trim() !== ''
  if (!written || entry.tagged_at == null) return null

  if (lineage.length === 0 && entry.wiki_indexed_at == null) {
    return (
      <View accessibilityLiveRegion="polite">
        <Card variant="sunken" style={styles.knowledgeCard} testID="entry-knowledge-pending">
          <Text variant="label" color="accent">Private synthesis in progress</Text>
          <Text variant="caption" color="textMuted" style={styles.statusText}>
            Your reflection is saved. Any wiki change will appear here once it is confirmed.
          </Text>
        </Card>
      </View>
    )
  }
  if (lineage.length === 0) return null

  return (
    <Card variant="sunken" style={styles.knowledgeCard} testID="entry-knowledge-trail">
      <Text variant="label" color="accent">This reflection contributed to…</Text>
      {lineage.map((page) => (
        <View key={page.id} style={styles.pageRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open the ${page.title} page`}
            onPress={() => router.push(`/wiki/${page.id}`)}
            testID="entry-page-link"
            style={styles.pageLink}
          >
            <Text variant="bodyStrong" color="accentText">{page.title} ›</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`See how ${page.title} evolved`}
            onPress={() => router.push(`/wiki/${page.id}/evolution`)}
            testID="entry-evolution-link"
            style={styles.evolutionLink}
          >
            <Text variant="caption" color="textSecondary">See what changed</Text>
          </Pressable>
        </View>
      ))}
    </Card>
  )
}

function ExploreSection({
  related,
  older,
  newer,
}: {
  related: Entry[]
  older: Entry | null
  newer: Entry | null
}) {
  const router = useRouter()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  if (related.length === 0 && !older && !newer) return null

  return (
    <View testID="entry-explore-section">
      {related.length > 0 ? (
        <View style={styles.related}>
          <Text variant="label" color="textSecondary">Related entries</Text>
          {related.map((item) => {
            const date = formatDate(item.created_at)
            return (
              <ListRow
                key={item.id}
                title={date}
                subtitle={entryPreview(item)}
                onPress={() => router.push(`/entries/${item.id}`)}
                testID="entry-related-link"
                right={<Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />}
              />
            )
          })}
        </View>
      ) : null}
      {(older || newer) ? (
        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open older entry"
            disabled={!older}
            onPress={() => older && router.replace(`/entries/${older.id}`)}
          >
            <Text variant="label" color={older ? 'accent' : 'textMuted'}>← Older</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open newer entry"
            disabled={!newer}
            onPress={() => newer && router.replace(`/entries/${newer.id}`)}
          >
            <Text variant="label" color={newer ? 'accent' : 'textMuted'}>Newer →</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

export default function EntryDetailScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { entry, loading } = useEntry(id)
  const { entries } = useEntries()
  const { older, newer } = useEntryNeighbors(entry)
  const { nodes } = useGraph()
  const { pages } = useWikiPages()
  const lineage = useEntryLineage(entry)

  const related = useMemo(() => {
    if (!entry) return []
    return entries.filter((candidate) => candidate.id !== entry.id && (
      (!!entry.emotion && candidate.emotion === entry.emotion) ||
      (!!entry.topic && candidate.topic === entry.topic) ||
      (!!entry.topic2 && candidate.topic === entry.topic2) ||
      (!!entry.topic && candidate.topic2 === entry.topic) ||
      (!!entry.topic2 && candidate.topic2 === entry.topic2)
    )).slice(0, 3)
  }, [entries, entry])

  if (loading) {
    return <Screen><View style={styles.center}><Text variant="body" color="textMuted">Loading…</Text></View></Screen>
  }
  if (!entry) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">That entry couldn’t be found.</Text>
          <Text variant="label" color="accent" onPress={() => router.back()}>← Back</Text>
        </View>
      </Screen>
    )
  }

  const graphLabels = [entry.topic, entry.topic2, entry.emotion]
    .filter((label): label is string => !!label && label.trim() !== '')
    .filter((label, index, labels) => labels.findIndex((candidate) => candidate.trim().toLowerCase() === label.trim().toLowerCase()) === index)
  const graphNodes = graphLabels
    .map((label) => nodes.find((node) => node.label.trim().toLowerCase() === label.trim().toLowerCase()))
    .filter((node): node is NonNullable<typeof node> => node != null)

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton name="arrow-back" onPress={() => router.back()} accessibilityLabel="Back" testID="entry-back" />
        <Text variant="title">{formatDate(entry.created_at)}</Text>
        <View style={styles.meta}>
          <Text variant="caption" color="textMuted">{formatTime(entry.created_at)}</Text>
          <MoodMeta mood={entry.mood} />
          {entry.named_emotion ? <Text variant="label" color="textSecondary">You felt: {entry.named_emotion}</Text> : null}
        </View>
      </View>

      <AuthoredReflection entry={entry} />
      <Divider />
      <LocalReflection entry={entry} pages={pages} graphNodes={graphNodes} />
      <KnowledgeTrail entry={entry} lineage={lineage} />
      <Divider />
      <ExploreSection related={related} older={older} newer={newer} />
    </Screen>
  )
}

const makeStyles = (t: Theme) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
  header: { gap: t.spacing.sm, marginBottom: t.spacing['2xl'] },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.spacing.md },
  situation: { marginBottom: t.spacing.lg },
  field: { gap: t.spacing.xs, marginTop: t.spacing.xl },
  compactField: { gap: t.spacing.xs, marginTop: t.spacing.md },
  quote: { borderLeftWidth: 2, borderLeftColor: t.colors.accent, paddingLeft: t.spacing.md },
  statusText: { marginTop: t.spacing.xs },
  localCard: { marginTop: t.spacing.lg, gap: t.spacing.xs },
  provenance: { marginTop: t.spacing.sm },
  knowledgeCard: { marginTop: t.spacing.lg, gap: t.spacing.sm },
  pageRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border, paddingTop: t.spacing.sm },
  pageLink: { paddingVertical: t.spacing.xs },
  evolutionLink: { paddingVertical: t.spacing.xs },
  related: { marginTop: t.spacing.lg },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: t.spacing.xl, paddingTop: t.spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border },
})
