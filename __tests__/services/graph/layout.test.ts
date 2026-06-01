import { computeLayout } from '@/services/graph/layout'

const OPTS = { width: 300, height: 300, iterations: 60 }

describe('computeLayout', () => {
  it('returns an empty map for no nodes', () => {
    expect(computeLayout([], [], OPTS).size).toBe(0)
  })

  it('positions every node within the bounds', () => {
    const ids = ['a', 'b', 'c', 'd']
    const edges = [{ source_id: 'a', target_id: 'b', weight: 3 }]
    const pos = computeLayout(ids, edges, OPTS)

    expect(pos.size).toBe(4)
    for (const id of ids) {
      const p = pos.get(id)!
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(300)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(300)
    }
  })

  it('is deterministic (no randomness)', () => {
    const ids = ['a', 'b', 'c']
    const edges = [{ source_id: 'a', target_id: 'b', weight: 1 }]
    const first = computeLayout(ids, edges, OPTS)
    const second = computeLayout(ids, edges, OPTS)
    for (const id of ids) {
      expect(second.get(id)).toEqual(first.get(id))
    }
  })
})
