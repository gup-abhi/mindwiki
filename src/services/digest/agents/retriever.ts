import { graphNeighborhood, type GraphNeighborhood } from '@/services/graph/neighborhood'
import { type Entry } from '@/services/storage/entries'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'
import { rankEntries, rankPages } from '@/services/wiki/search'

export interface DigestMaterial {
  /** The labels the week centered on (top emotion + top distortion). */
  focus: string[]
  /** Most relevant entries for the focus — the evidence pool. */
  entries: Entry[]
  /** Neighborhoods of the focus nodes in the graph. */
  neighborhoods: GraphNeighborhood[]
  /** Wiki pages most relevant to the focus. */
  pages: WikiPage[]
}

/** Most frequent non-empty, non-'none' label across the values. */
function topLabel(values: (string | null)[]): string | undefined {
  const counts = new Map<string, number>()
  for (const v of values) {
    const k = v?.trim().toLowerCase()
    if (k && k !== 'none') counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/**
 * Retriever (no LLM): gather the week's material for the analyst. Picks the
 * focus labels from the entries, then pulls the most relevant entries, graph
 * neighborhoods, and wiki pages for those labels. Pure — caller supplies data.
 */
export function gatherMaterial(
  entries: Entry[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  pages: WikiPage[]
): DigestMaterial {
  const focus = [
    topLabel(entries.map((e) => e.emotion)),
    topLabel(entries.map((e) => e.distortion)),
  ].filter((x): x is string => !!x)

  const query = focus.join(' ')

  return {
    focus,
    entries: query ? rankEntries(query, entries, 8) : entries.slice(0, 8),
    neighborhoods: focus
      .map((f) => graphNeighborhood(f, nodes, edges, 1))
      .filter((n): n is GraphNeighborhood => n !== null),
    pages: query ? rankPages(query, pages, 3).map((r) => r.page) : [],
  }
}
