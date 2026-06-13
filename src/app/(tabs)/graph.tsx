import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

import { Screen } from '@/components/ui'
import { Graph3D } from '@/components/graph/Graph3D'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useGraph } from '@/hooks/useGraph'
import { type GraphNode, type NodeType } from '@/services/storage/graph'

type Filter = NodeType | 'all'

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
  const { nodes, edges } = useGraph(width, height)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<GraphNode | null>(null)

  const presentTypes = useMemo(() => Array.from(new Set(nodes.map((n) => n.type))), [nodes])

  return (
    <Screen padded={false}>
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
          <Pressable onPress={() => setSelected(null)}>
            <Text style={styles.cardClose}>Close</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    pillBar: { flexGrow: 0, maxHeight: 40 },
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
    cardClose: { fontSize: 15, fontFamily: t.fontFamily.uiSemibold, color: t.colors.accent, marginTop: t.spacing.md },
  })
