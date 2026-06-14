import { type SqliteDatabase } from '@/services/storage/db'
import {
  upsertNode,
  upsertEdge,
  listNodes,
  listEdges,
  findNodeByLabel,
  dismissNode,
  restoreNodeDismissal,
  listActiveNodeDismissals,
  loadDismissedNodeKeys,
} from '@/services/storage/graph'

let mockUuidCounter = 0
jest.mock('expo-crypto', () => ({
  randomUUID: () => `g-${++mockUuidCounter}`,
}))

function createFakeDb() {
  const nodes = new Map<string, Record<string, unknown>>()
  const edges = new Map<string, Record<string, unknown>>()
  const dismissals = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      // --- node dismissals ---
      if (/^INSERT INTO graph_node_dismissals/.test(sql)) {
        const [id, type, label, dismissed_at, updated_at] = params
        const existing = dismissals.get(String(id))
        if (existing) Object.assign(existing, { dismissed_at, updated_at })
        else dismissals.set(String(id), { id, type, label, dismissed_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM graph_node_dismissals WHERE dismissed_at IS NOT NULL/.test(sql)) {
        const out = [...dismissals.values()]
          .filter((d) => d.dismissed_at != null)
          .sort((a, b) => Number(b.dismissed_at) - Number(a.dismissed_at))
        return { rows: out, rowsAffected: 0 }
      }
      if (/^UPDATE graph_node_dismissals SET dismissed_at = NULL/.test(sql)) {
        const [updated_at, id] = params
        const row = dismissals.get(String(id))
        if (row) Object.assign(row, { dismissed_at: null, updated_at })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^SELECT id FROM graph_nodes WHERE type/.test(sql)) {
        const matches = [...nodes.values()].filter(
          (n) =>
            n.type === params[0] &&
            String(n.label).toLowerCase() === String(params[1]).toLowerCase()
        )
        return { rows: matches.map((n) => ({ id: n.id })), rowsAffected: 0 }
      }
      if (/^DELETE FROM graph_edges WHERE source_id/.test(sql)) {
        let removed = 0
        for (const [id, e] of [...edges.entries()]) {
          if (e.source_id === params[0] || e.target_id === params[1]) {
            edges.delete(id)
            removed++
          }
        }
        return { rows: [], rowsAffected: removed }
      }
      if (/^DELETE FROM graph_nodes WHERE id/.test(sql)) {
        const had = nodes.delete(String(params[0]))
        return { rows: [], rowsAffected: had ? 1 : 0 }
      }
      if (/^SELECT \* FROM graph_nodes WHERE type/.test(sql)) {
        // Mirror "COLLATE NOCASE": match label case-insensitively.
        const row = [...nodes.values()].find(
          (n) =>
            n.type === params[0] &&
            String(n.label).toLowerCase() === String(params[1]).toLowerCase()
        )
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^INSERT INTO graph_nodes/.test(sql)) {
        const [id, type, label, frequency, created_at, updated_at] = params
        nodes.set(String(id), { id, type, label, frequency, created_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE graph_nodes SET frequency/.test(sql)) {
        const [frequency, updated_at, id] = params
        const row = nodes.get(String(id))
        if (row) Object.assign(row, { frequency, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM graph_nodes WHERE label/.test(sql)) {
        const matches = [...nodes.values()]
          .filter((n) => String(n.label).toLowerCase() === String(params[0]).toLowerCase())
          .sort((a, b) => Number(b.frequency) - Number(a.frequency))
        return { rows: matches.length ? [matches[0]] : [], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM graph_nodes ORDER BY/.test(sql)) {
        return { rows: [...nodes.values()], rowsAffected: 0 }
      }
      if (/^SELECT \* FROM graph_edges WHERE source_id/.test(sql)) {
        const row = [...edges.values()].find(
          (e) => e.source_id === params[0] && e.target_id === params[1]
        )
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^INSERT INTO graph_edges/.test(sql)) {
        const [id, source_id, target_id, weight, created_at, updated_at] = params
        edges.set(String(id), { id, source_id, target_id, weight, created_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE graph_edges SET weight/.test(sql)) {
        const [weight, updated_at, id] = params
        const row = edges.get(String(id))
        if (row) Object.assign(row, { weight, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM graph_edges/.test(sql)) {
        return { rows: [...edges.values()], rowsAffected: 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db }
}

describe('storage/graph', () => {
  beforeEach(() => {
    mockUuidCounter = 0
  })

  it('creates a node then increments its frequency on re-upsert', async () => {
    const { db } = createFakeDb()
    const first = await upsertNode('emotion', 'anxiety', db)
    expect(first.success && first.data.frequency).toBe(1)

    const second = await upsertNode('emotion', 'anxiety', db)
    expect(second.success && second.data.frequency).toBe(2)

    const nodes = await listNodes(db)
    expect(nodes.success && nodes.data).toHaveLength(1) // same node, not duplicated
  })

  it('treats different type/label as distinct nodes', async () => {
    const { db } = createFakeDb()
    await upsertNode('emotion', 'anxiety', db)
    await upsertNode('distortion', 'anxiety', db) // same label, different type
    const nodes = await listNodes(db)
    expect(nodes.success && nodes.data).toHaveLength(2)
  })

  it('merges labels that differ only by case (no duplicate)', async () => {
    const { db } = createFakeDb()
    await upsertNode('emotion', 'Loneliness', db)
    const second = await upsertNode('emotion', 'loneliness', db)
    expect(second.success && second.data.frequency).toBe(2)
    const nodes = await listNodes(db)
    expect(nodes.success && nodes.data).toHaveLength(1)
  })

  it('finds the most frequent same-label node regardless of type (case-insensitive)', async () => {
    const { db } = createFakeDb()
    await upsertNode('place', 'Work', db)
    await upsertNode('place', 'Work', db) // place "Work" -> frequency 2
    await upsertNode('situation', 'Work', db) // theme "Work" -> frequency 1

    const found = await findNodeByLabel('work', db)
    expect(found.success && found.data?.type).toBe('place')
    expect(found.success && found.data?.frequency).toBe(2)
  })

  it('returns null from findNodeByLabel when nothing matches', async () => {
    const { db } = createFakeDb()
    const found = await findNodeByLabel('nope', db)
    expect(found.success && found.data).toBeNull()
  })

  it('upserts an undirected edge (A,B) == (B,A) and increments weight', async () => {
    const { db } = createFakeDb()
    const e1 = await upsertEdge('nodeB', 'nodeA', db)
    expect(e1.success && e1.data.weight).toBe(1)
    // canonicalized: source is the lexicographically smaller id
    expect(e1.success && e1.data.source_id).toBe('nodeA')

    const e2 = await upsertEdge('nodeA', 'nodeB', db) // reversed
    expect(e2.success && e2.data.weight).toBe(2)

    const edges = await listEdges(db)
    expect(edges.success && edges.data).toHaveLength(1)
  })

  it('dismissNode removes the live node + its edges and records the dismissal', async () => {
    const { db } = createFakeDb()
    const a = await upsertNode('emotion', 'Anxiety', db)
    const b = await upsertNode('situation', 'Work', db)
    if (!a.success || !b.success) throw new Error('setup failed')
    await upsertEdge(a.data.id, b.data.id, db)

    const dropped = await dismissNode('emotion', 'Anxiety', db)
    expect(dropped.success).toBe(true)

    // node gone, and the edge touching it gone — the other node survives
    const nodes = await listNodes(db)
    expect(nodes.success && nodes.data.map((n) => n.label)).toEqual(['Work'])
    const edges = await listEdges(db)
    expect(edges.success && edges.data).toHaveLength(0)

    // recorded under the stable key, and exposed by loadDismissedNodeKeys
    const keys = await loadDismissedNodeKeys(db)
    expect(keys.has('emotion:anxiety')).toBe(true)
    const active = await listActiveNodeDismissals(db)
    expect(active.success && active.data.map((d) => d.label)).toEqual(['Anxiety'])
  })

  it('restoreNodeDismissal clears the flag so the key no longer suppresses', async () => {
    const { db } = createFakeDb()
    await upsertNode('emotion', 'Anxiety', db)
    await dismissNode('emotion', 'Anxiety', db)

    const restored = await restoreNodeDismissal('emotion:anxiety', db)
    expect(restored.success).toBe(true)

    const keys = await loadDismissedNodeKeys(db)
    expect(keys.has('emotion:anxiety')).toBe(false)
    const active = await listActiveNodeDismissals(db)
    expect(active.success && active.data).toHaveLength(0)
  })

  it('restoreNodeDismissal returns GRAPH_NODE_NOT_FOUND for an unknown id', async () => {
    const { db } = createFakeDb()
    const res = await restoreNodeDismissal('ghost:nope', db)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('GRAPH_NODE_NOT_FOUND')
  })
})
