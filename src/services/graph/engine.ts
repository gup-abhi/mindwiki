import { getDb } from '@/services/storage/db'
import { upsertNode, upsertEdge, type NodeType } from '@/services/storage/graph'
import { listEntries, type Entry } from '@/services/storage/entries'
import { listEntitiesForEntry } from '@/services/storage/entities'
import { type Result, ok, err } from '@/types/result'

/**
 * Build graph nodes + co-occurrence edges from a tagged entry: a node per
 * emotion / distortion / theme(topic) and per extracted entity (person / place /
 * activity), and an edge between every pair that co-occurred in this entry
 * (additive weight). Best-effort, never throws.
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

    // Extracted entities (person/place/activity) co-occur with the tags above.
    const entities = await listEntitiesForEntry(entry.id)
    if (entities.success) {
      for (const e of entities.data) specs.push({ type: e.type, label: e.label })
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

/**
 * Rebuild the derived graph from all entries. Needed after a sync pull on a new
 * device, where entries + entry_entities arrive as raw rows (no pipeline run) so
 * the graph would otherwise stay empty. Clears first to stay idempotent (graph
 * is additive). Best-effort, never throws.
 *
 * Restores emotion + distortion + theme (persisted `topic`) nodes and the
 * person/place/activity nodes from entry_entities (updateGraphForEntry reads
 * them per entry).
 */
export async function rebuildGraph(): Promise<Result<void>> {
  try {
    const db = getDb()
    await db.execute('DELETE FROM graph_edges')
    await db.execute('DELETE FROM graph_nodes')
    const entries = await listEntries(10000)
    if (!entries.success) return entries
    for (const entry of entries.data) {
      await updateGraphForEntry(entry, entry.topic)
    }
    return ok(undefined)
  } catch (e) {
    return err('GRAPH_REBUILD_FAILED', 'Failed to rebuild graph', e)
  }
}
