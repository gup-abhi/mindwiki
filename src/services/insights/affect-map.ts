import { type Entry } from '@/services/storage/entries'
import { quadrantFor, type AffectQuadrant } from '@/lib/feeling-words'

// Where a person's feelings land on the energy×pleasantness grid over a recent
// window — a density map over the same 5×5 the capture grid uses. Pure
// aggregation from tags (mood = pleasantness, energy); entries without an energy
// value (pre-migration-018) are simply excluded.

const DAY_MS = 86_400_000
const WINDOW_DAYS = 56 // last 8 weeks — matches the per-concept trend window
const MIN_ENTRIES = 8 // enough points to read a shape, not a lonely dot

export interface AffectCell {
  pleasantness: number // 1–5 (= mood)
  energy: number // 1–5
  count: number
}

export interface AffectMap {
  /** All 25 grid cells (including empties), so the view can render a full grid. */
  cells: AffectCell[]
  /** Entries with energy in the window (the map's sample size). */
  total: number
  /** Highest single-cell count — the intensity scale. */
  max: number
  /** The quadrant the feelings most often fall in. */
  dominant: AffectQuadrant
  /** Observational one-liner naming that region. */
  summary: string
}

/**
 * The affect map over the last 8 weeks, or null when there aren't yet enough
 * energy-carrying entries to read a shape. Pure — no IO.
 */
export function computeAffectMap(entries: Entry[], now: number): AffectMap | null {
  const start = now - WINDOW_DAYS * DAY_MS
  const pts = entries.filter(
    (e): e is Entry & { energy: number } =>
      e.energy != null && e.created_at >= start && e.created_at <= now
  )
  if (pts.length < MIN_ENTRIES) return null

  const counts = new Map<string, number>()
  for (const e of pts) counts.set(`${e.mood}-${e.energy}`, (counts.get(`${e.mood}-${e.energy}`) ?? 0) + 1)

  const cells: AffectCell[] = []
  let max = 0
  for (let energy = 1; energy <= 5; energy++) {
    for (let pleasantness = 1; pleasantness <= 5; pleasantness++) {
      const count = counts.get(`${pleasantness}-${energy}`) ?? 0
      cells.push({ pleasantness, energy, count })
      if (count > max) max = count
    }
  }

  const byQuadrant = new Map<AffectQuadrant, number>()
  for (const e of pts) {
    const q = quadrantFor(e.mood, e.energy)
    byQuadrant.set(q, (byQuadrant.get(q) ?? 0) + 1)
  }
  const dominant = [...byQuadrant.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral'

  return { cells, total: pts.length, max, dominant, summary: summaryFor(dominant) }
}

function summaryFor(q: AffectQuadrant): string {
  switch (q) {
    case 'pleasantLow':
      return 'Most often you land in the calm range — lower energy and pleasant.'
    case 'pleasantHigh':
      return 'Most often you land in the upbeat range — higher energy and pleasant.'
    case 'unpleasantHigh':
      return 'Most often you land in the tense range — higher energy and unpleasant.'
    case 'unpleasantLow':
      return 'Most often you land in the low range — lower energy and unpleasant.'
    case 'neutral':
      return 'Your feelings sit mostly in the middle — neither strongly high nor low.'
  }
}
