import { graphNeighborhood, connectionLine } from '@/services/graph/neighborhood'
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
