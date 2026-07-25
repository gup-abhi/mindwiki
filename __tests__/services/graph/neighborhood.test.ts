import { graphNeighborhood, connectionLine, pageConnections } from '@/services/graph/neighborhood'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'

const node = (id: string, label: string, frequency = 1): GraphNode => ({
  id,
  type: 'emotion',
  label,
  frequency,
  created_at: 0,
  updated_at: 0,
})

const edge = (id: string, a: string, b: string): GraphEdge => ({
  id,
  source_id: a,
  target_id: b,
  weight: 1,
  created_at: 0,
  updated_at: 0,
})

// a — b — c   (chain),   d isolated
const nodes = [node('a', 'Anxiety'), node('b', 'Work'), node('c', 'Deadlines'), node('d', 'Sleep')]
const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]

describe('graphNeighborhood', () => {
  it('returns direct neighbors at depth 1', () => {
    const n = graphNeighborhood('a', nodes, edges, 1)
    expect(n?.node.id).toBe('a')
    expect(n?.neighbors.map((x) => x.id)).toEqual(['b'])
    expect(n?.edges.map((x) => x.id)).toEqual(['e1'])
  })

  it('walks further hops at higher depth', () => {
    const n = graphNeighborhood('a', nodes, edges, 2)
    expect(n?.neighbors.map((x) => x.id).sort()).toEqual(['b', 'c'])
    expect(n?.edges.map((x) => x.id).sort()).toEqual(['e1', 'e2'])
  })

  it('matches by case-insensitive label', () => {
    expect(graphNeighborhood('anxiety', nodes, edges, 1)?.node.id).toBe('a')
  })

  it('returns an isolated node with no neighbors', () => {
    const n = graphNeighborhood('d', nodes, edges, 1)
    expect(n?.neighbors).toEqual([])
    expect(n?.edges).toEqual([])
  })

  it('returns null when nothing matches', () => {
    expect(graphNeighborhood('nope', nodes, edges, 1)).toBeNull()
  })
})

describe('connectionLine', () => {
  it('returns a formatted line with top neighbours sorted by frequency', () => {
    // b (Work, freq=1) is the only neighbour of a (Anxiety)
    const line = connectionLine('a', nodes, edges)
    expect(line).toBe('Anxiety often comes up with Work.')
  })

  it('sorts neighbours by descending frequency and caps at 3', () => {
    const high = node('h', 'Health', 20)
    const friends = node('f', 'Friends', 15)
    const money = node('m', 'Money', 10)
    const misc = [node('x', 'X', 1), node('y', 'Y', 1)]
    const allNodes = [node('a', 'Anxiety', 5), high, friends, money, ...misc]
    const allEdges = [
      edge('e1', 'a', 'h'),
      edge('e2', 'a', 'f'),
      edge('e3', 'a', 'm'),
      edge('e4', 'a', 'x'),
      edge('e5', 'a', 'y'),
    ]
    const line = connectionLine('a', allNodes, allEdges)
    expect(line).toBe('Anxiety often comes up with Health, Friends, Money.')
  })

  it('returns null when the page is not a graph node', () => {
    expect(connectionLine('Nope', nodes, edges)).toBeNull()
  })

  it('returns null when the node has no neighbours', () => {
    expect(connectionLine('d', nodes, edges)).toBeNull()
  })
})

describe('pageConnections', () => {
  // The structured source for the wiki-page connection block (WikiConnections)
  // — returns just the top-N neighbour labels, not a formatted prose line.
  it('returns the neighbour label list sorted by frequency', () => {
    const labels = pageConnections('a', nodes, edges)
    expect(labels).toEqual(['Work'])
  })

  it('caps at MAX_NEIGHBORS (3) and sorts by descending frequency', () => {
    const high = node('h', 'Health', 20)
    const friends = node('f', 'Friends', 15)
    const money = node('m', 'Money', 10)
    const misc = [node('x', 'X', 1), node('y', 'Y', 1)]
    const allNodes = [node('a', 'Anxiety', 5), high, friends, money, ...misc]
    const allEdges = [
      edge('e1', 'a', 'h'),
      edge('e2', 'a', 'f'),
      edge('e3', 'a', 'm'),
      edge('e4', 'a', 'x'),
      edge('e5', 'a', 'y'),
    ]
    expect(pageConnections('a', allNodes, allEdges)).toEqual(['Health', 'Friends', 'Money'])
  })

  it('returns [] when the title is not a graph node', () => {
    expect(pageConnections('Nope', nodes, edges)).toEqual([])
  })

  it('returns [] when the node has no neighbours', () => {
    expect(pageConnections('d', nodes, edges)).toEqual([])
  })

  it('matches by case-insensitive label', () => {
    expect(pageConnections('anxiety', nodes, edges)).toEqual(['Work'])
  })
})

// ── F-04a: weight-before-frequency sort ───────────────────────────────────

describe('F-04a.1 — lower-frequency node with stronger edge outranks higher-frequency', () => {
  const r = (id: string, label: string, freq = 1) => ({
    id, type: 'emotion' as const, label, frequency: freq, created_at: 0, updated_at: 0,
  })
  const e = (id: string, a: string, b: string, weight = 1): GraphEdge => ({
    id, source_id: a, target_id: b, weight, created_at: 0, updated_at: 0,
  })

  it('ranks lower-frequency node above higher-frequency when its edge is stronger', () => {
    const root = r('w', 'Work', 100)
    const stress = r('s', 'Stress', 50)
    const sleep = r('sl', 'Sleep', 10)
    const nodes = [root, stress, sleep]
    const edges = [
      e('e1', 'w', 's', 3),
      e('e2', 'w', 'sl', 10),
    ]
    // Sleep (edge weight 10) ranks before Stress (edge weight 3)
    expect(pageConnections('Work', nodes, edges)).toEqual(['Sleep', 'Stress'])
  })
})

describe('F-04a.2 — tiebreaker: frequency then label', () => {
  const r = (id: string, label: string, freq = 1) => ({
    id, type: 'emotion' as const, label, frequency: freq, created_at: 0, updated_at: 0,
  })
  const e = (id: string, a: string, b: string, weight = 1): GraphEdge => ({
    id, source_id: a, target_id: b, weight, created_at: 0, updated_at: 0,
  })

  it('uses frequency when weights equal', () => {
    const root = r('a', 'Anxiety', 100)
    const panic = r('p', 'Panic', 30)
    const worry = r('w', 'Worry', 20)
    const rumination = r('r', 'Rumination', 10)
    const nodes = [root, panic, worry, rumination]
    const edges = [
      e('e1', 'a', 'p', 5),
      e('e2', 'a', 'w', 5),
      e('e3', 'a', 'r', 5),
    ]
    expect(pageConnections('Anxiety', nodes, edges)).toEqual(['Panic', 'Worry', 'Rumination'])
  })

  it('uses label asc when weights and frequencies equal', () => {
    const root = r('a', 'Anxiety', 100)
    const apple = r('aa', 'Apple', 5)
    const banana = r('bb', 'Banana', 5)
    const cherry = r('cc', 'Cherry', 5)
    const nodes = [root, apple, banana, cherry]
    const edges = [
      e('e1', 'a', 'aa', 3),
      e('e2', 'a', 'bb', 3),
      e('e3', 'a', 'cc', 3),
    ]
    expect(pageConnections('Anxiety', nodes, edges)).toEqual(['Apple', 'Banana', 'Cherry'])
  })
})
