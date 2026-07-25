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
  depth = 1,
  nodeType?: GraphNode['type']
): GraphNeighborhood | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const t = target.toLowerCase()
  const candidates = nodes.filter((n) => n.label.toLowerCase() === t)
  const root = byId.get(target) ??
    (nodeType ? candidates.find((n) => n.type === nodeType) : undefined) ??
    candidates[0]
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

const MAX_NEIGHBORS = 3

/**
 * The top graph-neighbour labels for a page's title, sorted by frequency
 * (most-co-occurring first), capped at MAX_NEIGHBORS. The structured source
 * for a page's connections — rendered as deterministic tappable chips on the
 * page (Level 2), never woven into LLM prose. Returns [] when the title isn't
 * a graph node or has no neighbours. Pure — caller supplies nodes and edges.
 */
export function pageConnections(
  title: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  category?: string | null
): string[] {
  const nodeType = graphNodeTypeForWikiCategory(category)
  const hood = graphNeighborhood(title, nodes, edges, 1, nodeType)
  if (!hood || hood.neighbors.length === 0) return []
  return topNeighborLabels(hood)
}

function graphNodeTypeForWikiCategory(category?: string | null): GraphNode['type'] | undefined {
  if (category === 'theme') return 'situation'
  if (category === 'emotion' || category === 'distortion' || category === 'belief' || category === 'behavior') {
    return category
  }
  if (category === 'person' || category === 'place' || category === 'activity') return category
  return undefined
}

// The top neighbour labels of an already-computed neighborhood, ranked by:
//   1. direct edge weight descending — strongest connection first
//   2. node frequency descending — tiebreaker
//   3. normalized label ascending — deterministic final tie
// Capped at MAX_NEIGHBORS pure-ordered family. Each neighbor's direct edge
// is the one incident to hood.node whose other endpoint is the neighbor.
function topNeighborLabels(hood: GraphNeighborhood): string[] {
  const rootId = hood.node.id
  const weightById = new Map<string, number>()
  for (const e of hood.edges) {
    let otherId: string | null = null
    if (e.source_id === rootId) otherId = e.target_id
    else if (e.target_id === rootId) otherId = e.source_id
    if (otherId === null) continue
    // Keep the strongest weight when multiple edges connect to one neighbor.
    const cur = weightById.get(otherId) ?? 0
    if (e.weight > cur) weightById.set(otherId, e.weight)
  }
  return [...hood.neighbors]
    .map((n) => ({ n, w: weightById.get(n.id) ?? 0 }))
    .sort(
      (a, b) =>
        // 1. weight descending
        b.w - a.w ||
        // 2. frequency descending
        b.n.frequency - a.n.frequency ||
        // 3. normalized label ascending (case-insensitive, stable)
        a.n.label.trim().toLowerCase().localeCompare(b.n.label.trim().toLowerCase())
    )
    .slice(0, MAX_NEIGHBORS)
    .map(({ n }) => n.label)
}

/**
 * A one-line description of a page's top graph connections, e.g.
 * "Anxiety often comes up with Work, Sleep." Returns null when the title
 * is not a graph node or has no neighbours. Used by the chat/conversation path
 * (retrieval context), NOT by page synthesis — connections on a wiki page
 * render from `pageConnections` as a structured block. Pure — caller supplies
 * nodes and edges.
 */
export function connectionLine(
  title: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  category?: string | null
): string | null {
  const hood = graphNeighborhood(title, nodes, edges, 1, graphNodeTypeForWikiCategory(category))
  if (!hood || hood.neighbors.length === 0) return null
  // Reuse the neighborhood we just computed rather than calling pageConnections
  // (which would walk the graph a second time).
  const top = topNeighborLabels(hood)
  return `${hood.node.label} often comes up with ${top.join(', ')}.`
}
