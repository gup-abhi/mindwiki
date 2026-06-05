import { type GraphNode, type GraphEdge } from '@/services/storage/graph'

export interface GraphNeighborhood {
  node: GraphNode
  /** Nodes reachable from `node` within `depth` hops. */
  neighbors: GraphNode[]
  /** Edges traversed to reach them. */
  edges: GraphEdge[]
}

/**
 * The local neighborhood of a node. Matches `target` by id or case-insensitive
 * label, then walks edges outward to `depth` hops. Returns the matched node plus
 * the nodes reachable within `depth` and the edges traversed. Null when nothing
 * matches. Pure — caller supplies the nodes and edges.
 */
export function graphNeighborhood(
  target: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  depth = 1
): GraphNeighborhood | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const t = target.toLowerCase()
  const root = byId.get(target) ?? nodes.find((n) => n.label.toLowerCase() === t)
  if (!root) return null

  const visited = new Set<string>([root.id])
  const collected: GraphEdge[] = []
  const seenEdge = new Set<string>()
  let frontier = new Set<string>([root.id])

  for (let d = 0; d < depth && frontier.size > 0; d++) {
    const next = new Set<string>()
    for (const edge of edges) {
      let other: string | null = null
      if (frontier.has(edge.source_id)) other = edge.target_id
      else if (frontier.has(edge.target_id)) other = edge.source_id
      if (other === null || !byId.has(other)) continue

      if (!seenEdge.has(edge.id)) {
        seenEdge.add(edge.id)
        collected.push(edge)
      }
      if (!visited.has(other)) {
        visited.add(other)
        next.add(other)
      }
    }
    frontier = next
  }

  const neighbors = [...visited]
    .filter((id) => id !== root.id)
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => n !== undefined)

  return { node: root, neighbors, edges: collected }
}
