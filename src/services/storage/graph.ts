import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'

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
