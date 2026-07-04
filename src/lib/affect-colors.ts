import { type Theme } from '@/theme'

// The 4-corner color code of the energy×pleasantness grid, shared by the capture
// grid (MoodGrid) and the Trends affect map so the two can never drift apart:
//   top-left  red   — unpleasant + high energy (tense)
//   top-right amber — pleasant + high energy (upbeat)
//   bot-left  blue  — unpleasant + low energy (low)
//   bot-right green — pleasant + low energy (calm)

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const rgba = (c: RGB, a: number): string =>
  `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`

/**
 * Bilinear blend of the four affect-grid corners for a normalized point
 * (`px`: 0 unpleasant → 1 pleasant, `py`: 0 low → 1 high energy), at `alpha`.
 */
export function affectColor(theme: Theme, px: number, py: number, alpha: number): string {
  const tl = hexToRgb(theme.colors.danger) // unpleasant + high
  const tr = hexToRgb(theme.colors.moodOkay) // pleasant + high
  const bl = hexToRgb(theme.colors.graphSituation) // unpleasant + low
  const br = hexToRgb(theme.colors.success) // pleasant + low
  const hue = mix(mix(bl, br, px), mix(tl, tr, px), py)
  return rgba(hue, alpha)
}
