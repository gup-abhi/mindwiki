import { getDb } from '@/services/storage/db'
import {
  upsertNode,
  upsertEdge,
  findNodeByLabel,
  loadDismissedNodeKeys,
  nodeDismissalKey,
  type NodeType,
} from '@/services/storage/graph'
import {
  listEntriesForGraph,
  countEntriesByEmotion,
  countEntriesByDistortion,
  countEntriesByAnyTopic,
  markAllGraphIndexed,
  type Entry,
} from '@/services/storage/entries'
import { listEntitiesForEntry, countEntriesForEntity, type EntityType } from '@/services/storage/entities'
import { type Result, ok, err } from '@/types/result'

// A node only materializes once it's corroborated by at least this many entries.
// Additive-only graph means a node is permanent, so a single (possibly wrong)
// tag must never seed one — it has to recur first. Matches the wiki recurrence
// gate (RECURRENCE_THRESHOLD).
const GRAPH_NODE_MIN_ENTRIES = 2

/** How many entries support a (type,label) — drives the recurrence gate. */
export type SupportCounter = (type: NodeType, label: string) => Promise<number>

// Live single-entry counter: one cheap COUNT per node. On a count error it fails
// OPEN (Infinity) so a query glitch never silently drops legitimate nodes.
async function liveSupportCount(type: NodeType, label: string): Promise<number> {
  const r =
    type === 'emotion'
      ? await countEntriesByEmotion(label)
      : type === 'distortion'
        ? await countEntriesByDistortion(label)
        : type === 'situation'
          ? await countEntriesByAnyTopic(label)
          : await countEntriesForEntity(type as EntityType, label)
  return r.success ? r.data : Infinity
}

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
  topics?: string[] | null,
  dismissed?: Set<string>,
  support: SupportCounter = liveSupportCount
): Promise<Result<void>> {
  try {
    // Nodes the user dropped are excluded from the derivation. Loaded here for a
    // live single-entry call; rebuildGraph loads it once and passes it down.
    const dropped = dismissed ?? (await loadDismissedNodeKeys())
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
      if (dropped.has(nodeDismissalKey(spec.type, spec.label))) continue
      // Recurrence gate: skip until this signal is corroborated by ≥2 entries, so
      // a single (possibly mistagged) entry never seeds a permanent node.
      if ((await support(spec.type, spec.label)) < GRAPH_NODE_MIN_ENTRIES) continue
      const node = await upsertNode(spec.type, spec.label)
      if (node.success) {
        ids.push(node.data.id)
        labels.add(spec.label.toLowerCase())
      }
    }

    for (const topic of topics ?? []) {
      const theme = topic.trim()
      if (!theme || labels.has(theme.toLowerCase())) continue
      // Reuse an existing same-label node (any type) so "Work" the theme and
      // "Work" the place stay one node; otherwise it's a new theme node.
      const existing = await findNodeByLabel(theme)
      const matched = existing.success ? existing.data : null
      const themeType = matched ? matched.type : 'situation'
      // An existing node already cleared its gate; a brand-new situation node
      // must clear the topic recurrence gate before it's created.
      const allowed = matched != null || (await support('situation', theme)) >= GRAPH_NODE_MIN_ENTRIES
      if (allowed && !dropped.has(nodeDismissalKey(themeType, theme))) {
        const node = await upsertNode(themeType, theme)
        if (node.success && !ids.includes(node.data.id)) ids.push(node.data.id)
      }
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
    const dismissed = await loadDismissedNodeKeys(db) // loaded once for the whole rebuild
    const support = await precomputedSupport(db) // counts once, not per (entry × node)
    const entries = await listEntriesForGraph(10000)
    if (!entries.success) return entries
    for (const entry of entries.data) {
      const themes = [entry.topic, entry.topic2].filter((t): t is string => !!t && t.length > 0)
      await updateGraphForEntry(entry, themes, dismissed, support)
    }
    // The graph now reflects every entry — clear the graph-heal backlog (and
    // re-stamp any entry whose graph_indexed_at a sync pull's REPLACE wiped).
    await markAllGraphIndexed(db)
    return ok(undefined)
  } catch (e) {
    return err('GRAPH_REBUILD_FAILED', 'Failed to rebuild graph', e)
  }
}

// Read every label→count once into in-memory maps and return a SupportCounter
// that serves the recurrence gate from them — avoids an O(entries × nodes) query
// storm during a full rebuild.
async function precomputedSupport(db = getDb()): Promise<SupportCounter> {
  const groupCount = async (sql: string): Promise<Map<string, number>> => {
    const res = await db.execute(sql)
    const m = new Map<string, number>()
    for (const row of res.rows) {
      const k = String(row.k ?? '').toLowerCase()
      if (k) m.set(k, Number(row.n ?? 0))
    }
    return m
  }
  const emotion = await groupCount('SELECT emotion AS k, COUNT(*) AS n FROM entries GROUP BY emotion COLLATE NOCASE')
  const distortion = await groupCount('SELECT distortion AS k, COUNT(*) AS n FROM entries GROUP BY distortion COLLATE NOCASE')
  // Situation node recurrence counts both topic and topic2. Build a unified map
  // by summing the per-entry distribution of each label.
  const topic2 = await groupCount('SELECT topic2 AS k, COUNT(*) AS n FROM entries GROUP BY topic2 COLLATE NOCASE')
  const topic1 = await groupCount('SELECT topic AS k, COUNT(*) AS n FROM entries GROUP BY topic COLLATE NOCASE')
  const topic = new Map<string, number>([...topic1])
  for (const [k, n] of topic2) topic.set(k, (topic.get(k) ?? 0) + n)

  const entityRes = await db.execute(
    'SELECT type, label, COUNT(DISTINCT entry_id) AS n FROM entry_entities GROUP BY type, label COLLATE NOCASE'
  )
  const entity = new Map<string, number>()
  for (const row of entityRes.rows) {
    entity.set(`${String(row.type)}:${String(row.label ?? '').toLowerCase()}`, Number(row.n ?? 0))
  }

  return (type, label) => {
    const k = label.toLowerCase()
    const n =
      type === 'emotion'
        ? emotion.get(k)
        : type === 'distortion'
          ? distortion.get(k)
          : type === 'situation'
            ? topic.get(k)
            : entity.get(`${type}:${k}`)
    return Promise.resolve(n ?? 0)
  }
}
