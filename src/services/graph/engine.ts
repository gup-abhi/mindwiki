import { upsertNode, upsertEdge, type NodeType } from '@/services/storage/graph'
import { type Entry } from '@/services/storage/entries'
import { type Result, ok, err } from '@/types/result'

/**
 * Build graph nodes + co-occurrence edges from a tagged entry: a node per
 * emotion / distortion / theme(topic), and an edge between every pair that
 * co-occurred in this entry (additive weight). Best-effort, never throws.
 */
export async function updateGraphForEntry(
  entry: Entry,
  topic?: string | null
): Promise<Result<void>> {
  try {
    const specs: { type: NodeType; label: string }[] = []
    const emotion = entry.emotion?.trim()
    const distortion = entry.distortion?.trim()
    if (emotion) {
      specs.push({ type: 'emotion', label: emotion })
    }
    if (distortion && distortion.toLowerCase() !== 'none') {
      specs.push({ type: 'distortion', label: distortion })
    }
    const theme = topic?.trim()
    if (theme) {
      // Skip the theme node when it just repeats this entry's emotion or
      // distortion (e.g. emotion "loneliness" + topic "Loneliness") so the
      // same concept doesn't appear as two nodes.
      const duplicatesTag = [emotion, distortion].some(
        (l) => l != null && l.toLowerCase() === theme.toLowerCase()
      )
      if (!duplicatesTag) specs.push({ type: 'situation', label: theme })
    }

    const ids: string[] = []
    for (const spec of specs) {
      const node = await upsertNode(spec.type, spec.label)
      if (node.success) ids.push(node.data.id)
    }

    // Edge between every co-occurring pair.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertEdge(ids[i], ids[j])
      }
    }

    return ok(undefined)
  } catch (e) {
    return err('GRAPH_UPDATE_FAILED', 'Failed to update graph', e)
  }
}
