import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsert } from './sync-queue'

export type NodeType =
  | 'emotion'
  | 'situation'
  | 'person'
  | 'belief'
  | 'behavior'
  | 'distortion'
  | 'place'
  | 'activity'

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  frequency: number
  created_at: number
  updated_at: number
}

export interface GraphEdge {
  id: string
  source_id: string
  target_id: string
  weight: number
  created_at: number
  updated_at: number
}

function rowToNode(row: Record<string, unknown>): GraphNode {
  return {
    id: String(row.id),
    type: String(row.type) as NodeType,
    label: String(row.label),
    frequency: Number(row.frequency),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }
}

function rowToEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: String(row.id),
    source_id: String(row.source_id),
    target_id: String(row.target_id),
    weight: Number(row.weight),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }
}

/**
 * Additive node upsert: increments frequency if (type,label) exists, else
 * creates it at frequency 1. Returns the resulting node.
 */
export async function upsertNode(
  type: NodeType,
  label: string,
  db: SqliteDatabase = getDb()
): Promise<Result<GraphNode>> {
  try {
    const now = Date.now()
    const existing = await db.execute(
      'SELECT * FROM graph_nodes WHERE type = ? AND label = ? COLLATE NOCASE',
      [type, label]
    )
    const row = existing.rows[0]
    if (row) {
      const node = rowToNode(row)
      await db.execute(
        'UPDATE graph_nodes SET frequency = ?, updated_at = ? WHERE id = ?',
        [node.frequency + 1, now, node.id]
      )
      return ok({ ...node, frequency: node.frequency + 1, updated_at: now })
    }
    const node: GraphNode = {
      id: randomUUID(),
      type,
      label,
      frequency: 1,
      created_at: now,
      updated_at: now,
    }
    await db.execute(
      'INSERT INTO graph_nodes (id, type, label, frequency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [node.id, node.type, node.label, 1, now, now]
    )
    return ok(node)
  } catch (e) {
    return err('GRAPH_NODE_UPSERT_FAILED', 'Failed to upsert graph node', e)
  }
}

/**
 * Additive edge upsert (undirected — the id pair is canonicalized so (A,B) and
 * (B,A) are the same edge). Increments weight if present, else creates at 1.
 * Edges are never removed in normal use (ADR 006).
 */
export async function upsertEdge(
  nodeA: string,
  nodeB: string,
  db: SqliteDatabase = getDb()
): Promise<Result<GraphEdge>> {
  try {
    const [source_id, target_id] = [nodeA, nodeB].sort()
    const now = Date.now()
    const existing = await db.execute(
      'SELECT * FROM graph_edges WHERE source_id = ? AND target_id = ?',
      [source_id, target_id]
    )
    const row = existing.rows[0]
    if (row) {
      const edge = rowToEdge(row)
      await db.execute('UPDATE graph_edges SET weight = ?, updated_at = ? WHERE id = ?', [
        edge.weight + 1,
        now,
        edge.id,
      ])
      return ok({ ...edge, weight: edge.weight + 1, updated_at: now })
    }
    const edge: GraphEdge = {
      id: randomUUID(),
      source_id,
      target_id,
      weight: 1,
      created_at: now,
      updated_at: now,
    }
    await db.execute(
      'INSERT INTO graph_edges (id, source_id, target_id, weight, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [edge.id, edge.source_id, edge.target_id, 1, now, now]
    )
    return ok(edge)
  } catch (e) {
    return err('GRAPH_EDGE_UPSERT_FAILED', 'Failed to upsert graph edge', e)
  }
}

/**
 * First node whose label matches (any type, case-insensitive), most frequent
 * first — or null. Lets a loose theme attach to an existing concrete node
 * (person/place/activity/emotion) instead of spawning a duplicate same-named node.
 */
export async function findNodeByLabel(
  label: string,
  db: SqliteDatabase = getDb()
): Promise<Result<GraphNode | null>> {
  try {
    const res = await db.execute(
      'SELECT * FROM graph_nodes WHERE label = ? COLLATE NOCASE ORDER BY frequency DESC LIMIT 1',
      [label]
    )
    const row = res.rows[0]
    return ok(row ? rowToNode(row) : null)
  } catch (e) {
    return err('GRAPH_NODE_FIND_FAILED', 'Failed to find graph node', e)
  }
}

export async function listNodes(db: SqliteDatabase = getDb()): Promise<Result<GraphNode[]>> {
  try {
    const res = await db.execute('SELECT * FROM graph_nodes ORDER BY frequency DESC')
    return ok(res.rows.map(rowToNode))
  } catch (e) {
    return err('GRAPH_NODES_LIST_FAILED', 'Failed to list graph nodes', e)
  }
}

export async function listEdges(db: SqliteDatabase = getDb()): Promise<Result<GraphEdge[]>> {
  try {
    const res = await db.execute('SELECT * FROM graph_edges')
    return ok(res.rows.map(rowToEdge))
  } catch (e) {
    return err('GRAPH_EDGES_LIST_FAILED', 'Failed to list graph edges', e)
  }
}

// --- Node dismissal (drop a wrong graph node) ---------------------------------
// The graph is derived (rebuilt from entries), so suppression lives in its own
// table keyed by stable identity. The id is deterministic — `type:label`
// lowercased — so the same node maps to one row across devices (sync resolves
// drop/restore by last-write-wins) and a re-drop reuses the row.

export interface GraphNodeDismissal {
  id: string
  type: NodeType
  label: string
  /** When the user dropped this node; null when restored. */
  dismissed_at: number | null
  updated_at: number
}

/** Stable identity / dismissal-set key for a (type, label) node. */
export function nodeDismissalKey(type: string, label: string): string {
  return `${type}:${label}`.toLowerCase()
}

function rowToDismissal(row: Record<string, unknown>): GraphNodeDismissal {
  return {
    id: String(row.id),
    type: String(row.type) as NodeType,
    label: String(row.label),
    dismissed_at: row.dismissed_at == null ? null : Number(row.dismissed_at),
    updated_at: Number(row.updated_at),
  }
}

/** Nodes the user has dropped, most-recently-dropped first. */
export async function listActiveNodeDismissals(
  db: SqliteDatabase = getDb()
): Promise<Result<GraphNodeDismissal[]>> {
  try {
    const res = await db.execute(
      'SELECT * FROM graph_node_dismissals WHERE dismissed_at IS NOT NULL ORDER BY dismissed_at DESC'
    )
    return ok(res.rows.map(rowToDismissal))
  } catch (e) {
    return err('GRAPH_DISMISSAL_LIST_FAILED', 'Failed to list dropped nodes', e)
  }
}

/** Set of dismissed node keys, for the graph derivation to skip. */
export async function loadDismissedNodeKeys(
  db: SqliteDatabase = getDb()
): Promise<Set<string>> {
  const res = await listActiveNodeDismissals(db)
  if (!res.success) return new Set()
  return new Set(res.data.map((d) => nodeDismissalKey(d.type, d.label)))
}

/**
 * Drop a node the user flagged as wrong: record the (soft, reversible) dismissal
 * and remove the live node + every edge touching it so it disappears at once.
 * The derivation skips it on future entries / rebuilds (loadDismissedNodeKeys).
 */
export async function dismissNode(
  type: string,
  label: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    const id = nodeDismissalKey(type, label)
    const now = Date.now()
    await db.execute(
      `INSERT INTO graph_node_dismissals (id, type, label, dismissed_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET dismissed_at = excluded.dismissed_at, updated_at = excluded.updated_at`,
      [id, type, label, now, now]
    )
    // Remove the live node(s) + their edges so the change shows immediately.
    const existing = await db.execute(
      'SELECT id FROM graph_nodes WHERE type = ? AND label = ? COLLATE NOCASE',
      [type, label]
    )
    for (const row of existing.rows) {
      const nodeId = String(row.id)
      await db.execute('DELETE FROM graph_edges WHERE source_id = ? OR target_id = ?', [
        nodeId,
        nodeId,
      ])
      await db.execute('DELETE FROM graph_nodes WHERE id = ?', [nodeId])
    }
    await enqueueUpsert('graph_node_dismissals', id, db)
    return ok(undefined)
  } catch (e) {
    return err('GRAPH_NODE_DISMISS_FAILED', 'Failed to drop graph node', e)
  }
}

/**
 * Restore a dropped node. Clears the flag; the node + its edges return on the
 * next graph rebuild (the caller triggers one) since the graph is derived.
 */
export async function restoreNodeDismissal(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    const res = await db.execute(
      'UPDATE graph_node_dismissals SET dismissed_at = NULL, updated_at = ? WHERE id = ?',
      [Date.now(), id]
    )
    if ((res.rowsAffected ?? 0) === 0) return err('GRAPH_NODE_NOT_FOUND', 'Dropped node not found')
    await enqueueUpsert('graph_node_dismissals', id, db)
    return ok(undefined)
  } catch (e) {
    return err('GRAPH_NODE_RESTORE_FAILED', 'Failed to restore graph node', e)
  }
}
