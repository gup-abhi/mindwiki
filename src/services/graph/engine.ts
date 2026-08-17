import { getDb, type SqliteDatabase } from '@/services/storage/db'
import {
  upsertNode,
  upsertEdge,
  findNodeByLabel,
  loadDismissedNodeKeys,
  nodeDismissalKey,
  type NodeType,
} from '@/services/storage/graph'
import {
  listEntriesForGraphPage,
  countEntriesByEmotion,
  countEntriesByDistortion,
  countEntriesByAnyTopic,
  type Entry,
} from '@/services/storage/entries'
import { listEntitiesForEntry, countEntriesForEntity, effectiveLabel, type EntityType } from '@/services/storage/entities'
import { type Result, ok, err } from '@/types/result'

// A node only materializes once it's corroborated by at least this many entries.
// Additive-only graph means a node is permanent, so a single (possibly wrong)
// tag must never seed one — it has to recur first. Matches the wiki recurrence
// gate (RECURRENCE_THRESHOLD).
const GRAPH_NODE_MIN_ENTRIES = 2

/** How many entries support a (type,label) — drives the recurrence gate. */
export type SupportCounter = (type: NodeType, label: string) => Promise<number>

// Live single-entry counter: one cheap COUNT per node. On a count error it fails
// CLOSED (0), so the recurrence gate holds: a query glitch can't seed a permanent
// (additive-only) node from a single, possibly-wrong tag. The entry then stays
// graph-pending and launch catch-up re-derives it via a full rebuild — nothing is
// lost, whereas a wrongly-seeded node would be permanent.
async function liveSupportCount(type: NodeType, label: string): Promise<number> {
  const r =
    type === 'emotion'
      ? await countEntriesByEmotion(label)
      : type === 'distortion'
        ? await countEntriesByDistortion(label)
        : type === 'situation'
          ? await countEntriesByAnyTopic(label)
          : await countEntriesForEntity(type as EntityType, label)
  return r.success ? r.data : 0
}

// The graph is additive (upserts only add), so a live per-entry update racing a
// full rebuild can double-count an entry that lands between the rebuild's clear
// and its entry snapshot — and nothing heals it (rebuild IS the healer). Both
// paths are already background, so a promise-chain mutex serializes them at zero
// UX cost: each acquisition waits on the previous one's completion. rebuildGraph
// takes the lock ONCE and calls the unlocked impl in its loop, so its own
// per-entry updates don't re-enter (which would deadlock a non-reentrant lock).
let graphLock: Promise<void> = Promise.resolve()
function withGraphLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = graphLock.then(fn, fn)
  // Keep the chain alive regardless of fn's outcome; swallow here so a rejection
  // doesn't poison the next waiter (callers still get run's real result).
  graphLock = run.then(
    () => undefined,
    () => undefined
  )
  return run
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
 *
 * Serialized against rebuildGraph (and other live updates) via the graph mutex so
 * an additive per-entry write can't interleave with a clear+re-derive.
 */
export function updateGraphForEntry(
  entry: Entry,
  topics?: string[] | null,
  dismissed?: Set<string>,
  support: SupportCounter = liveSupportCount
): Promise<Result<void>> {
  return withGraphLock(() => updateGraphForEntryImpl(entry, topics, dismissed, support, getDb()))
}

async function updateGraphForEntryImpl(
  entry: Entry,
  topics: string[] | null | undefined,
  dismissed: Set<string> | undefined,
  support: SupportCounter,
  db: SqliteDatabase
): Promise<Result<void>> {
  try {
    // Nodes the user dropped are excluded from the derivation. Loaded here for a
    // live single-entry call; rebuildGraph loads it once and passes it down.
    const dropped = dismissed ?? (await loadDismissedNodeKeys(db))
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
    // F-02B: key on the EFFECTIVE label so an alias snapped to a canonical
    // identity contributes to that canonical node instead of fragmenting into
    // a node for the raw alias. Two raw aliases on one entry that share a
    // canonical identity count ONCE for graph frequency/edges (deduped below).
    const entities = await listEntitiesForEntry(entry.id, db)
    if (entities.success) {
      for (const e of entities.data) concrete.push({ type: e.type, label: effectiveLabel(e) })
    }

    const ids: string[] = []
    const labels = new Set<string>()
    // F-02B: dedupe concrete specs by (type, lowercased effective label) so two
    // aliases on one entry that share a canonical identity upsert ONE node and
    // don't upsert a self-pair edge between them. Runs AFTER the rows are mapped
    // to effective labels, so raw labels sharing a canonical merge here.
    const dedupedConcrete: { type: NodeType; label: string }[] = []
    const seenConcrete = new Set<string>()
    for (const spec of concrete) {
      const dedupKey = `${spec.type}:${spec.label.toLowerCase()}`
      if (seenConcrete.has(dedupKey)) continue
      seenConcrete.add(dedupKey)
      dedupedConcrete.push(spec)
    }
    // Accepted live-vs-rebuild divergence: on the entry that trips the gate (support
    // 1→2), only THIS entry's contribution is written — the node starts at frequency
    // 1 (a full rebuild would say 2) and the prior supporting entry's edges are
    // absent. The live graph therefore undercounts until the next rebuild, which
    // re-derives from all entries and corrects it upward (sync pull, page merge,
    // launch heal all trigger one). We accept this: node size / edge weight are
    // approximate corroboration signals, not exact counts, and the divergence only
    // ever self-heals upward. Backfilling the prior entry here would reintroduce the
    // double-count risk the additive model exists to avoid.
    for (const spec of dedupedConcrete) {
      // Dismissal identity is deliberately exact by (type,label): suppressing
      // place:Work does not suppress an independently-derived situation:Work.
      if (dropped.has(nodeDismissalKey(spec.type, spec.label))) continue
      // Recurrence gate: skip until this signal is corroborated by ≥2 entries, so
      // a single (possibly mistagged) entry never seeds a permanent node.
      if ((await support(spec.type, spec.label)) < GRAPH_NODE_MIN_ENTRIES) continue
      const node = await upsertNode(spec.type, spec.label, db)
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
      const existing = await findNodeByLabel(theme, db)
      const matched = existing.success ? existing.data : null
      const themeType = matched ? matched.type : 'situation'
      // An existing node already cleared its gate; a brand-new situation node
      // must clear the topic recurrence gate before it's created.
      const allowed = matched != null || (await support('situation', theme)) >= GRAPH_NODE_MIN_ENTRIES
      if (allowed && !dropped.has(nodeDismissalKey(themeType, theme))) {
        const node = await upsertNode(themeType, theme, db)
        if (node.success && !ids.includes(node.data.id)) ids.push(node.data.id)
      }
    }

    // Edge between every co-occurring pair.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await upsertEdge(ids[i], ids[j], db)
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
 *
 * Holds the graph mutex for the whole clear+re-derive so no live per-entry update
 * can interleave and double-count. Its own loop calls the UNLOCKED impl (already
 * inside the lock) — calling the public updateGraphForEntry would deadlock.
 */
export function rebuildGraph(): Promise<Result<void>> {
  return withGraphLock(rebuildGraphImpl)
}

async function rebuildGraphImpl(): Promise<Result<void>> {
  try {
    const db = getDb()
    // One transaction so a UI read mid-rebuild never sees a partially-empty graph
    // (the mutex already serializes against concurrent writes, but without the tx
    // a reader can observe the graph between the DELETE and the last re-derive).
    let anyFailed = false
    // Keep support counts, entry reads, graph writes, and backlog stamping in one
    // SQLite transaction snapshot. Only one page is retained at a time.
    await db.transaction(async (tx) => {
      const dismissed = await loadDismissedNodeKeys(tx)
      const support = await precomputedSupport(tx)
      await tx.execute('DELETE FROM graph_edges')
      await tx.execute('DELETE FROM graph_nodes')

      let cursor: { createdAt: number; id: string } | null = null
      do {
        const page = await listEntriesForGraphPage({ limit: 500, cursor }, tx)
        if (!page.success) {
          throw new Error('Failed to read graph entry page')
        }
        for (const entry of page.data.items) {
          const themes = [entry.topic, entry.topic2].filter((t): t is string => !!t && t.length > 0)
          const res = await updateGraphForEntryImpl(entry, themes, dismissed, support, tx)
          if (!res.success) anyFailed = true
        }
        cursor = page.data.nextCursor
      } while (cursor)

      // Stamp only after every page and entry folded in cleanly. A failed page or
      // row leaves the durable backlog eligible for a complete retry.
      if (!anyFailed) {
        await tx.execute(
          'UPDATE entries SET graph_indexed_at = ? WHERE tagged_at IS NOT NULL AND graph_indexed_at IS NULL',
          [Date.now()]
        )
      }
    })
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
  // Situation node recurrence counts an entry whose topic OR topic2 is the label,
  // once. Counting DISTINCT entries over a UNION of the two columns (rather than
  // summing two GROUP BYs) matches the live path's countEntriesByAnyTopic OR-query:
  // an entry with topic == topic2 must count once, not twice, or a single entry
  // would clear the ≥2 gate on rebuild while the live path counts it once.
  const topic = await groupCount(
    `SELECT k, COUNT(DISTINCT eid) AS n FROM (
       SELECT id AS eid, topic AS k FROM entries WHERE topic IS NOT NULL AND topic != ''
       UNION ALL
       SELECT id AS eid, topic2 AS k FROM entries WHERE topic2 IS NOT NULL AND topic2 != ''
     ) GROUP BY k COLLATE NOCASE`
  )

  const entityRes = await db.execute(
    `SELECT type, COALESCE(canonical_label, label) AS eff, COUNT(DISTINCT entry_id) AS n
       FROM entry_entities GROUP BY type, eff COLLATE NOCASE`
  )
  const entity = new Map<string, number>()
  for (const row of entityRes.rows) {
    entity.set(`${String(row.type)}:${String(row.eff ?? '').toLowerCase()}`, Number(row.n ?? 0))
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
