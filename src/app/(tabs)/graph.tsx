import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { Screen } from '@/components/ui'
import { Graph3D } from '@/components/graph/Graph3D'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useGraph, useNodeContext, useNodeDismissals } from '@/hooks/useGraph'
import { dismissNode, type GraphNode, type NodeType } from '@/services/storage/graph'

type Filter = NodeType | 'all'

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function GraphScreen() {
  const { width, height } = useWindowDimensions()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const colors: Record<NodeType, string> = {
    emotion: theme.colors.graphEmotion,
    situation: theme.colors.graphSituation,
    person: theme.colors.graphPerson,
    belief: theme.colors.graphBelief,
    behavior: theme.colors.graphBehavior,
    distortion: theme.colors.graphDistortion,
    place: theme.colors.graphPlace,
    activity: theme.colors.graphActivity,
  }
  const router = useRouter()
  const { nodes, edges, refresh } = useGraph(width, height)
  const { dismissals, refresh: refreshHidden } = useNodeDismissals()
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const { context } = useNodeContext(selected)

  const presentTypes = useMemo(() => Array.from(new Set(nodes.map((n) => n.type))), [nodes])

  const confirmDrop = (node: GraphNode) => {
    Alert.alert(
      `Remove “${node.label}” from your graph?`,
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

  return (
    <Screen padded={false}>
      <View style={styles.topRow}>
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
                setSelected(null) // switching filter exits node focus
              }}
              style={[styles.pill, filter === f && styles.pillActive]}
            >
              <Text style={[styles.pillText, filter === f && styles.pillTextActive]}>{f}</Text>
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
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No graph yet — write entries and your emotions, themes, and patterns will connect here.
          </Text>
        </View>
      ) : (
        <View style={styles.canvas}>
          <Graph3D
            nodes={nodes}
            edges={edges}
            colors={colors}
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{selected.label}</Text>
          <Text style={styles.cardMeta}>
            {selected.type} · appeared {selected.frequency}{' '}
            {selected.frequency === 1 ? 'time' : 'times'}
          </Text>

          <ScrollView style={styles.cardScroll} showsVerticalScrollIndicator={false}>
            {context && context.pages.length > 0 && (
              <View style={styles.cardSection}>
                <Text style={styles.cardSectionLabel}>Pages it shaped</Text>
                {context.pages.map((p) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open the ${p.title} page`}
                    onPress={() => router.push(`/wiki/${p.id}`)}
                    style={styles.linkRow}
                    testID="graph-node-page"
                  >
                    <Text style={styles.linkTitle} numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Text style={styles.linkChevron}>›</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {context && context.entries.length > 0 && (
              <View style={styles.cardSection}>
                <Text style={styles.cardSectionLabel}>
                  {context.entries.length === 1 ? 'Entry behind it' : 'Entries behind it'}
                </Text>
                {context.entries.slice(0, 6).map((e) => (
                  <Pressable
                    key={e.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/entries/${e.id}`)}
                    style={styles.linkRow}
                    testID="graph-node-entry"
                  >
                    <Text style={styles.linkTitle} numberOfLines={1}>
                      {e.situation.trim() || 'Mood check-in'}
                    </Text>
                    <Text style={styles.linkDate}>{formatShortDate(e.created_at)}</Text>
                  </Pressable>
                ))}
                {context.entries.length > 6 && (
                  <Text style={styles.cardMore}>+{context.entries.length - 6} more</Text>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.cardActions}>
            <Pressable onPress={() => confirmDrop(selected)} testID="graph-drop">
              <Text style={styles.cardDrop}>Remove from graph</Text>
            </Pressable>
            <Pressable onPress={() => setSelected(null)}>
              <Text style={styles.cardClose}>Close</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    topRow: { flexDirection: 'row', alignItems: 'center' },
    pillBar: { flexGrow: 1, maxHeight: 40 },
    hiddenLink: { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.xs },
    hiddenText: { color: t.colors.accent, fontSize: 13, fontFamily: t.fontFamily.uiSemibold },
    pills: { paddingHorizontal: t.spacing.lg, gap: t.spacing.sm, alignItems: 'center' },
    pill: {
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.lg,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.surfaceAlt,
      alignSelf: 'flex-start',
    },
    pillActive: { backgroundColor: t.colors.primary },
    pillText: { color: t.colors.textPrimary, fontSize: 13, fontFamily: t.fontFamily.uiSemibold, textTransform: 'capitalize' },
    pillTextActive: { color: t.colors.primaryText },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing['2xl'] },
    emptyText: { color: t.colors.textMuted, fontSize: 15, fontFamily: t.fontFamily.serifRegular, textAlign: 'center', lineHeight: 22 },
    canvas: { flex: 1, width: '100%' },
    card: {
      position: 'absolute',
      left: t.spacing.xl,
      right: t.spacing.xl,
      bottom: t.spacing['2xl'],
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.lg,
      padding: t.spacing.lg,
      ...t.shadows.high,
    },
    cardTitle: { fontSize: 18, fontFamily: t.fontFamily.serifSemibold, color: t.colors.textPrimary },
    cardMeta: { fontSize: 14, fontFamily: t.fontFamily.uiRegular, color: t.colors.textSecondary, marginTop: t.spacing.xs },
    cardScroll: { maxHeight: 220 },
    cardSection: { marginTop: t.spacing.md },
    cardSectionLabel: {
      fontSize: 12,
      fontFamily: t.fontFamily.uiSemibold,
      color: t.colors.accent,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: t.spacing.xs,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: t.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.surfaceAlt,
      gap: t.spacing.md,
    },
    linkTitle: { flex: 1, fontSize: 15, fontFamily: t.fontFamily.uiRegular, color: t.colors.textPrimary },
    linkChevron: { fontSize: 18, color: t.colors.accent },
    linkDate: { fontSize: 13, fontFamily: t.fontFamily.uiRegular, color: t.colors.textMuted },
    cardMore: { fontSize: 13, fontFamily: t.fontFamily.uiRegular, color: t.colors.textMuted, marginTop: t.spacing.sm },
    cardActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: t.spacing.md },
    cardDrop: { fontSize: 15, fontFamily: t.fontFamily.uiSemibold, color: t.colors.danger },
    cardClose: { fontSize: 15, fontFamily: t.fontFamily.uiSemibold, color: t.colors.accent },
  })
