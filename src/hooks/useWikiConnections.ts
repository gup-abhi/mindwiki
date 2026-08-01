import { useEffect, useState } from 'react'

import { pageConnections } from '@/services/graph/neighborhood'
import { type GraphEdge, type GraphNode, listNodes, listEdges } from '@/services/storage/graph'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { type Result } from '@/types/result'
import { useSyncStore } from '@/store/sync.store'

export type WikiConnectionsStatus = 'loading' | 'loaded' | 'error'

export interface WikiConnectionsData {
  status: WikiConnectionsStatus
  labels: string[]
  nodes: GraphNode[]
  pages: WikiPage[]
  error: string | null
}

/**
 * Owns the storage reads, sync-revision refresh, cancellation, and page
 * resolution data for a wiki page's "Often comes up with" block.
 *
 * States:
 *   'loading' — first fetch in progress
 *   'error'   — graph/page read failure (never masquerades as empty)
 *   'loaded'  — labels is [] when no connections, non-empty when connections exist
 *
 * Pure: does NOT import or render any UI.
 */
export function useWikiConnections(title: string, category?: string | null): WikiConnectionsData {
  const revision = useSyncStore((s) => s.revision)
  const [data, setData] = useState<WikiConnectionsData>({
    status: 'loading',
    labels: [],
    nodes: [],
    pages: [],
    error: null,
  })

  useEffect(() => {
    let active = true
    setData({ status: 'loading', labels: [], nodes: [], pages: [], error: null })

    void (async () => {
      const results = await Promise.allSettled([
        listNodes(),
        listEdges(),
        listPages(),
      ])

      if (!active) return

      // Check for failures.
      const failures: string[] = []
      const nodeRes = results[0]
      const edgeRes = results[1]
      const pageRes = results[2]

      if (nodeRes.status === 'rejected' || (nodeRes.status === 'fulfilled' && !nodeRes.value.success)) {
        failures.push('nodes')
      }
      if (edgeRes.status === 'rejected' || (edgeRes.status === 'fulfilled' && !edgeRes.value.success)) {
        failures.push('edges')
      }
      if (pageRes.status === 'rejected' || (pageRes.status === 'fulfilled' && !pageRes.value.success)) {
        failures.push('pages')
      }

      if (failures.length > 0) {
        setData({
          status: 'error',
          labels: [],
          nodes: [],
          pages: [],
          error: `Failed to read graph: ${failures.join(', ')}`,
        })
        return
      }

      const nodeValue = nodeRes as PromiseFulfilledResult<Result<GraphNode[]>>
      const edgeValue = edgeRes as PromiseFulfilledResult<Result<GraphEdge[]>>
      const pageValue = pageRes as PromiseFulfilledResult<Result<WikiPage[]>>
      if (!nodeValue.value.success || !edgeValue.value.success || !pageValue.value.success) return
      const nodes = nodeValue.value.data
      const edges = edgeValue.value.data
      const allPages = pageValue.value.data
      const live = allPages.filter((p: WikiPage) => p.dismissed_at == null && p.merged_into == null)

      const labels = pageConnections(title, nodes, edges, category)

      setData({
        status: 'loaded',
        labels,
        nodes,
        pages: live,
        error: null,
      })
    })()

    return () => {
      active = false
    }
  }, [title, category, revision])

  return data
}
