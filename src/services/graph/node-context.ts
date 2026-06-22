import { type GraphNode } from '@/services/storage/graph'
import {
  listEntriesByEmotion,
  listEntriesByDistortion,
  listEntriesByTopic,
  listEntriesForEntity,
  type Entry,
} from '@/services/storage/entries'
import { listPages } from '@/services/storage/wiki'
import { rankPages } from '@/services/wiki/search'
import { type Result, ok } from '@/types/result'

/** A wiki page surfaced behind a graph node — enough to render a tappable link. */
export interface NodePage {
  id: string
  title: string
  category: string | null
}

/** What a graph node connects to: the entries that produced it and the wiki
 *  pages it shaped / is discussed in. The graph's navigation payload. */
export interface NodeContext {
  entries: Entry[]
  pages: NodePage[]
}

// The entries behind a node depend on its type: emotion/distortion/situation map
// to entry tag columns; person/place/activity/belief/behavior map to extracted
// entities (entry_entities rows).
function entriesForNode(node: GraphNode): Promise<Result<Entry[]>> {
  switch (node.type) {
    case 'emotion':
      return listEntriesByEmotion(node.label)
    case 'distortion':
      return listEntriesByDistortion(node.label)
    case 'situation':
      return listEntriesByTopic(node.label)
    case 'person':
    case 'place':
    case 'activity':
    case 'belief':
    case 'behavior':
      return listEntriesForEntity(node.type, node.label)
    default:
      return Promise.resolve(ok([]))
  }
}

/**
 * The entries and wiki pages behind a graph node — so tapping a node can open
 * the evidence that built it. Pages: the exact same-titled page (the one this
 * concept shaped) first, then other live pages that discuss the label, ranked by
 * relevance. Dismissed pages are excluded. Best-effort: a failed lookup yields an
 * empty list rather than failing the whole context.
 */
export async function contextForNode(node: GraphNode): Promise<Result<NodeContext>> {
  const entriesRes = await entriesForNode(node)
  const entries = entriesRes.success ? entriesRes.data : []

  const pagesRes = await listPages()
  const live = pagesRes.success ? pagesRes.data.filter((p) => p.dismissed_at == null) : []
  const label = node.label.trim().toLowerCase()
  const exact = live.find((p) => p.title.trim().toLowerCase() === label)
  const ranked = rankPages(node.label, live).map((r) => r.page)
  const ordered = exact ? [exact, ...ranked.filter((p) => p.id !== exact.id)] : ranked
  const pages: NodePage[] = ordered
    .slice(0, 5)
    .map((p) => ({ id: p.id, title: p.title, category: p.category }))

  return ok({ entries, pages })
}
