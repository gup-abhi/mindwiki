/** 4-based spacing scale + radius scale, replacing the ad-hoc margins/paddings. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const

export type Spacing = typeof spacing
export type Radii = typeof radii
