import { type ColorScheme } from './scheme'

export interface ShadowStyle {
  shadowColor: string
  shadowOffset: { width: number; height: number }
  shadowOpacity: number
  shadowRadius: number
  elevation: number
}

export interface Shadows {
  low: ShadowStyle
  med: ShadowStyle
  high: ShadowStyle
}

/** Soft, calm elevation. Slightly stronger opacity in dark mode to stay visible. */
export function makeShadows(scheme: ColorScheme): Shadows {
  const o = scheme === 'dark' ? 1.6 : 1
  return {
    low: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05 * o, shadowRadius: 3, elevation: 1 },
    med: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08 * o, shadowRadius: 10, elevation: 3 },
    high: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12 * o, shadowRadius: 20, elevation: 6 },
  }
}
