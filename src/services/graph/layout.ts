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

    // Gentle gravity toward the centre keeps small or disconnected graphs from
    // drifting apart and pinning against the edges.
    for (const id of nodeIds) {
      const p = pos.get(id)!
      const d = disp.get(id)!
      d.x += (cx - p.x) * 0.03
      d.y += (cy - p.y) * 0.03
    }

    // Apply displacement, limited by temperature (no hard clamp — the final
    // pass below scales the whole layout to fit the canvas).
    for (const id of nodeIds) {
      const d = disp.get(id)!
      const p = pos.get(id)!
      const dl = Math.hypot(d.x, d.y) || 0.01
      p.x += (d.x / dl) * Math.min(dl, temp)
      p.y += (d.y / dl) * Math.min(dl, temp)
    }

    temp *= 0.95 // cool
  }

  // Fit the resulting bounding box into the canvas with padding, centred, so
  // nodes and their labels always sit comfortably inside the viewport
  // regardless of node count.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pos.values()) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  const pad = 44
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const s = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY)
  const offX = (width - spanX * s) / 2
  const offY = (height - spanY * s) / 2
  for (const [id, p] of pos) {
    pos.set(id, { x: offX + (p.x - minX) * s, y: offY + (p.y - minY) * s })
  }

  return pos
}
