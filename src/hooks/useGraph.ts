import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listNodes, listEdges, type GraphNode, type GraphEdge } from '@/services/storage/graph'
import { computeLayout, type Point } from '@/services/graph/layout'
import { useSyncStore } from '@/store/sync.store'

/** Loads the graph and computes node positions for a canvas of width x height. */
export function useGraph(width: number, height: number) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    const [n, e] = await Promise.all([listNodes(), listEdges()])
    if (n.success) setNodes(n.data)
    if (e.success) setEdges(e.data)
  }, [])

  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh, revision])
  )

  const layout = useMemo<Map<string, Point>>(
    () =>
      computeLayout(
        nodes.map((n) => n.id),
        edges,
        { width, height }
      ),
    [nodes, edges, width, height]
  )

  return { nodes, edges, layout }
}
