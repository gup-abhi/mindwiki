export interface LayoutEdge {
  source_id: string
  target_id: string
  weight: number
}

export interface Point {
  x: number
  y: number
}

export interface LayoutOptions {
  width: number
  height: number
  iterations?: number
}

/**
 * Deterministic Fruchterman-Reingold force-directed layout in pure TypeScript
 * (no d3, no randomness — seeded on a circle so the same input always yields
 * the same positions). Repulsion between all nodes, attraction along edges
 * (scaled by capped weight), with a cooling temperature; positions clamped to
 * the bounds.
 */
export function computeLayout(
  nodeIds: string[],
  edges: LayoutEdge[],
  { width, height, iterations = 100 }: LayoutOptions
): Map<string, Point> {
  const pos = new Map<string, Point>()
  const n = nodeIds.length
  if (n === 0) return pos

  const k = Math.sqrt((width * height) / n) // ideal edge length
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(width, height) / 3

  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n
    pos.set(id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  })

  let temp = width / 10

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, Point>(nodeIds.map((id) => [id, { x: 0, y: 0 }]))

    // Repulsion between every pair.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodeIds[i])!
        const b = pos.get(nodeIds[j])!
        const dx = a.x - b.x
        const dy = a.y - b.y
        const dist = Math.hypot(dx, dy) || 0.01
        const force = (k * k) / dist
        const ux = dx / dist
        const uy = dy / dist
        const da = disp.get(nodeIds[i])!
        const db = disp.get(nodeIds[j])!
        da.x += ux * force
        da.y += uy * force
        db.x -= ux * force
        db.y -= uy * force
      }
    }

    // Attraction along edges (heavier edges pull harder, capped).
    for (const edge of edges) {
      const a = pos.get(edge.source_id)
      const b = pos.get(edge.target_id)
      if (!a || !b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dist = Math.hypot(dx, dy) || 0.01
      const force = ((dist * dist) / k) * Math.min(edge.weight, 5)
      const ux = dx / dist
      const uy = dy / dist
      const da = disp.get(edge.source_id)!
      const db = disp.get(edge.target_id)!
      da.x -= ux * force
      da.y -= uy * force
      db.x += ux * force
      db.y += uy * force
    }

    // Apply displacement, limited by temperature; clamp to bounds.
    for (const id of nodeIds) {
      const d = disp.get(id)!
      const p = pos.get(id)!
      const dl = Math.hypot(d.x, d.y) || 0.01
      p.x += (d.x / dl) * Math.min(dl, temp)
      p.y += (d.y / dl) * Math.min(dl, temp)
      p.x = Math.max(0, Math.min(width, p.x))
      p.y = Math.max(0, Math.min(height, p.y))
    }

    temp *= 0.95 // cool
  }

  return pos
}
