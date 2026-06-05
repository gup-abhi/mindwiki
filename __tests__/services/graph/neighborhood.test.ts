import { graphNeighborhood } from '@/services/graph/neighborhood'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'

const node = (id: string, label: string): GraphNode => ({
  id,
  type: 'emotion',
  label,
  frequency: 1,
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
