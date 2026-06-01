import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg'

import { useGraph } from '@/hooks/useGraph'
import { type NodeType } from '@/services/storage/graph'

const COLORS: Record<NodeType, string> = {
  emotion: '#e06c75',
  situation: '#61afef',
  person: '#98c379',
  belief: '#c678dd',
  behavior: '#e5c07b',
  distortion: '#56b6c2',
}

type Filter = NodeType | 'all'

function radius(frequency: number): number {
  return 8 + Math.min(frequency, 10) * 2
}

export default function GraphScreen() {
  const { width, height } = useWindowDimensions()
  const canvasH = Math.round(height * 0.7)
  const { nodes, edges, layout } = useGraph(width, canvasH)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const visibleNodes = useMemo(
    () => (filter === 'all' ? nodes : nodes.filter((n) => n.type === filter)),
    [nodes, filter]
  )
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes])
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source_id) && visibleIds.has(e.target_id)),
    [edges, visibleIds]
  )

  const presentTypes = useMemo(
    () => Array.from(new Set(nodes.map((n) => n.type))),
    [nodes]
  )
  const selected = visibleNodes.find((n) => n.id === selectedId) ?? null

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pills}
      >
        {(['all', ...presentTypes] as Filter[]).map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            onPress={() => setFilter(f)}
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
        <Svg width={width} height={canvasH}>
          {visibleEdges.map((e) => {
            const a = layout.get(e.source_id)
            const b = layout.get(e.target_id)
            if (!a || !b) return null
            return (
              <Line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#ccc"
                strokeWidth={Math.min(e.weight, 4)}
                strokeDasharray={e.weight < 4 ? '4 4' : undefined}
              />
            )
          })}
          {visibleNodes.map((n) => {
            const p = layout.get(n.id)
            if (!p) return null
            return (
              <Circle
                key={n.id}
                testID="graph-node"
                cx={p.x}
                cy={p.y}
                r={radius(n.frequency)}
                fill={COLORS[n.type]}
                onPress={() => setSelectedId(n.id)}
              />
            )
          })}
          {visibleNodes.map((n) => {
            const p = layout.get(n.id)
            if (!p) return null
            return (
              <SvgText key={`${n.id}-label`} x={p.x} y={p.y - radius(n.frequency) - 4} fontSize={11} fill="#444" textAnchor="middle">
                {n.label}
              </SvgText>
            )
          })}
        </Svg>
      )}

      {selected && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{selected.label}</Text>
          <Text style={styles.cardMeta}>
            {selected.type} · appeared {selected.frequency}{' '}
            {selected.frequency === 1 ? 'time' : 'times'}
          </Text>
          <Pressable onPress={() => setSelectedId(null)}>
            <Text style={styles.cardClose}>Close</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  pills: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#f2f2f7' },
  pillActive: { backgroundColor: '#1a1a2e' },
  pillText: { color: '#1a1a2e', fontSize: 14, textTransform: 'capitalize' },
  pillTextActive: { color: '#fff' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: '#999', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  card: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 32,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  cardMeta: { fontSize: 14, color: '#666', marginTop: 4 },
  cardClose: { fontSize: 15, color: '#7a7ad0', fontWeight: '600', marginTop: 12 },
})
