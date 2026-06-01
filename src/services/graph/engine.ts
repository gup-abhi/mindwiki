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
    if (entry.emotion && entry.emotion.trim()) {
      specs.push({ type: 'emotion', label: entry.emotion.trim() })
    }
    if (entry.distortion && entry.distortion.trim().toLowerCase() !== 'none') {
      specs.push({ type: 'distortion', label: entry.distortion.trim() })
    }
    if (topic && topic.trim()) {
      specs.push({ type: 'situation', label: topic.trim() })
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
