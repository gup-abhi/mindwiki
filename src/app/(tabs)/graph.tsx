import { useMemo, useRef, useState } from 'react'
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg'

import { Screen } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useGraph } from '@/hooks/useGraph'
import { type NodeType } from '@/services/storage/graph'

type Filter = NodeType | 'all'

function radius(frequency: number): number {
  return 8 + Math.min(frequency, 10) * 2
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
  }
  // Canvas fills the space left under the filter pills — measured via onLayout
  // rather than a fixed fraction of the screen, so the graph isn't cramped.
  const [canvasH, setCanvasH] = useState(Math.round(height * 0.7))
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

  // Zoom + pan: a single transform applied to the whole graph. Drag pans,
  // the buttons zoom around the canvas centre. PanResponder only claims the
  // gesture once the finger actually moves, so taps still reach the nodes.
  const [tf, setTf] = useState({ scale: 1, tx: 0, ty: 0 })
  const tfRef = useRef(tf)
  tfRef.current = tf
  // Live mirror of the data the gesture handler needs (the PanResponder is
  // created once, so it must read positions/transform through a ref).
  const dataRef = useRef({ nodes: visibleNodes, layout, tf })
  dataRef.current = { nodes: visibleNodes, layout, tf }
  const startRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const tapRef = useRef(false)

  // Map a touch (in canvas coordinates) to the node under it, accounting for
  // the current pan/zoom transform; null when the tap misses every node.
  function hitTest(lx: number, ly: number): string | null {
    const { nodes, layout, tf } = dataRef.current
    for (const n of nodes) {
      const p = layout.get(n.id)
      if (!p) continue
      const sx = tf.tx + tf.scale * p.x
      const sy = tf.ty + tf.scale * p.y
      const rr = radius(n.frequency) * tf.scale + 10 // touch slop
      if ((lx - sx) ** 2 + (ly - sy) ** 2 <= rr * rr) return n.id
    }
    return null
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = tfRef.current
        tapRef.current = true
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) <= 6 && Math.abs(g.dy) <= 6) return
        tapRef.current = false // it's a drag, not a tap
        setTf({
          scale: startRef.current.scale,
          tx: startRef.current.tx + g.dx,
          ty: startRef.current.ty + g.dy,
        })
      },
      onPanResponderRelease: (e) => {
        if (!tapRef.current) return // was a drag
        setSelectedId(hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY))
      },
    })
  ).current

  function zoomBy(factor: number) {
    setTf((v) => {
      const scale = Math.max(0.4, Math.min(4, v.scale * factor))
      const r = scale / v.scale
      return {
        scale,
        tx: (width / 2) * (1 - r) + r * v.tx,
        ty: (canvasH / 2) * (1 - r) + r * v.ty,
      }
    })
  }

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
        <View
          style={styles.canvas}
          onLayout={(e) => setCanvasH(Math.round(e.nativeEvent.layout.height))}
        >
          <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
          <Svg width={width} height={canvasH}>
            <G transform={`translate(${tf.tx}, ${tf.ty}) scale(${tf.scale})`}>
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
                stroke={theme.colors.border}
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
                fill={colors[n.type]}
                onPress={() => setSelectedId(n.id)}
              />
            )
          })}
          {visibleNodes.map((n) => {
            const p = layout.get(n.id)
            if (!p) return null
            return (
              <SvgText key={`${n.id}-label`} x={p.x} y={p.y - radius(n.frequency) - 4} fontSize={11} fill={theme.colors.textSecondary} textAnchor="middle">
                {n.label}
              </SvgText>
            )
          })}
            </G>
          </Svg>
          </View>
          <View style={styles.zoomControls}>
            <Pressable accessibilityRole="button" style={styles.zoomBtn} onPress={() => zoomBy(1.25)}>
              <Text style={styles.zoomText}>+</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.zoomBtn} onPress={() => zoomBy(0.8)}>
              <Text style={styles.zoomText}>−</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.zoomBtn}
              onPress={() => setTf({ scale: 1, tx: 0, ty: 0 })}
            >
              <Text style={styles.zoomReset}>⤢</Text>
            </Pressable>
          </View>
        </View>
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
    zoomControls: { position: 'absolute', right: t.spacing.lg, top: t.spacing.md, gap: t.spacing.sm },
    zoomBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.shadows.med,
    },
    zoomText: { fontSize: 24, color: t.colors.textPrimary, lineHeight: 26 },
    zoomReset: { fontSize: 18, color: t.colors.textPrimary },
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
