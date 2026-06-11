import { getDb } from '@/services/storage/db'
import { upsertNode, upsertEdge, findNodeByLabel, type NodeType } from '@/services/storage/graph'
import { listEntries, type Entry } from '@/services/storage/entries'
import { listEntitiesForEntry } from '@/services/storage/entities'
import { type Result, ok, err } from '@/types/result'

/**
 * Build graph nodes + co-occurrence edges from a tagged entry: a node per
 * concrete signal (emotion / distortion / extracted person / place / activity)
 * plus the theme(topic), with an edge between every pair that co-occurred in
 * this entry (additive weight). Best-effort, never throws.
 *
 * The theme is a loose signal, so it never spawns a duplicate of a concrete
 * node: if its label already exists (this entry's tags/entities, or any prior
 * node of any type) it attaches to that node instead of creating a second
 * same-named "situation" node. Only a genuinely new concept becomes its own.
 */
export async function updateGraphForEntry(
  entry: Entry,
  topic?: string | null
): Promise<Result<void>> {
  try {
    const concrete: { type: NodeType; label: string }[] = []
    const emotion = entry.emotion?.trim()
    const distortion = entry.distortion?.trim()
    if (emotion) {
      concrete.push({ type: 'emotion', label: emotion })
    }
    if (distortion && distortion.toLowerCase() !== 'none') {
      concrete.push({ type: 'distortion', label: distortion })
    }
    // Extracted entities (person/place/activity) co-occur with the tags above.
    const entities = await listEntitiesForEntry(entry.id)
    if (entities.success) {
      for (const e of entities.data) concrete.push({ type: e.type, label: e.label })
    }

    const ids: string[] = []
    const labels = new Set<string>()
    for (const spec of concrete) {
      const node = await upsertNode(spec.type, spec.label)
      if (node.success) {
        ids.push(node.data.id)
        labels.add(spec.label.toLowerCase())
      }
    }

    const theme = topic?.trim()
    if (theme && !labels.has(theme.toLowerCase())) {
      // Reuse an existing same-label node (any type) so "Work" the theme and
      // "Work" the place stay one node; otherwise it's a new theme node.
      const existing = await findNodeByLabel(theme)
      const matched = existing.success ? existing.data : null
      const node = await upsertNode(matched ? matched.type : 'situation', theme)
      if (node.success && !ids.includes(node.data.id)) ids.push(node.data.id)
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
