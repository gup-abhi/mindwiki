import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import {
  listNodes,
  listEdges,
  listActiveNodeDismissals,
  restoreNodeDismissal,
  type GraphNode,
  type GraphEdge,
  type GraphNodeDismissal,
} from '@/services/storage/graph'

import { rebuildGraph } from '@/services/graph/engine'
import { contextForNode, type NodeContext } from '@/services/graph/node-context'
import { useSyncStore } from '@/store/sync.store'

/** Loads graph data for the interactive 3D map. Layout runs inside WebView. */
export function useGraph() {
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

  return { nodes, edges, refresh }
}

/** The entries + wiki pages behind a selected node, reloaded when it changes.
 *  Null when no node is selected; empty lists while loading or on lookup error. */
export function useNodeContext(node: GraphNode | null) {
  const [context, setContext] = useState<NodeContext | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!node) {
      setContext(null)
      return
    }
    let active = true
    setLoading(true)
    contextForNode(node).then((res) => {
      if (!active) return
      setContext(res.success ? res.data : { entries: [], pages: [] })
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [node])

  return { context, loading }
}

/** Nodes the user has dropped from the graph; restore brings them back. */
export function useNodeDismissals() {
  const [dismissals, setDismissals] = useState<GraphNodeDismissal[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await listActiveNodeDismissals()
    if (res.success) setDismissals(res.data)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  // Clearing the flag isn't enough — the graph is derived, so re-derive it so the
  // node + its edges reappear before we re-list.
  const restore = useCallback(
    async (id: string) => {
      const res = await restoreNodeDismissal(id)
      if (res.success) await rebuildGraph()
      await refresh()
    },
    [refresh]
  )

  return { dismissals, loading, refresh, restore }
}
