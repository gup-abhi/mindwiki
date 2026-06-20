/**
 * Color tokens. `lightColors` and `darkColors` share an identical key shape so
 * every themed style can read `theme.colors.<role>` and work in both modes.
 * Calm sage/eucalyptus palette on a warm cream base — green reads restorative
 * for a journaling app. Neutrals carry a faint green-gray undertone so nothing
 * clashes with the accent.
 */
export interface ColorTokens {
  bg: string
  surface: string
  surfaceAlt: string
  surfaceSunken: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textInverse: string
  accent: string
  accentMuted: string
  accentText: string
  primary: string
  primaryText: string
  border: string
  divider: string
  success: string
  danger: string
  dangerText: string
  overlay: string
  // Mood scale (1–5): a red→amber→green diverging ramp, reused for the entry
  // color bar + mood chips so mood reads at a glance.
  moodVeryLow: string
  moodLow: string
  moodOkay: string
  moodGood: string
  moodGreat: string
  // Knowledge-graph node colors (centralized so the graph themes consistently).
  graphEmotion: string
  graphSituation: string
  graphPerson: string
  graphBelief: string
  graphBehavior: string
  graphDistortion: string
  graphPlace: string
  graphActivity: string
  // Edge/link color for the knowledge graph (lighter on dark so links read).
  graphEdge: string
}

export const lightColors: ColorTokens = {
  bg: '#FBF8F4',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF3EE',
  surfaceSunken: '#E6EDE6',
  textPrimary: '#222B25',
  textSecondary: '#5F6E66',
  textMuted: '#9AA69D',
  textInverse: '#FFFFFF',
  accent: '#7BA589',
  accentMuted: '#E4EDE6',
  accentText: '#3C6450',
  primary: '#2F4739',
  primaryText: '#FFFFFF',
  border: '#E4EBE4',
  divider: '#EBF1EC',
  success: '#3C8F66',
  danger: '#C75D5D',
  dangerText: '#FFFFFF',
  overlay: 'rgba(34,43,37,0.35)',
  moodVeryLow: '#C75D5D',
  moodLow: '#D69A6F',
  moodOkay: '#E0BE72',
  moodGood: '#84C29A',
  moodGreat: '#3C8F66',
  graphEmotion: '#E08A8A',
  graphSituation: '#6FA8DC',
  graphPerson: '#84C29A',
  graphBelief: '#6577C0',
  graphBehavior: '#E0BE72',
  graphDistortion: '#6FC2C9',
  graphPlace: '#D69A6F',
  graphActivity: '#9AA86F',
  graphEdge: '#C4D0C6',
}

export const darkColors: ColorTokens = {
  bg: '#121613',
  surface: '#1B211C',
  surfaceAlt: '#242B25',
  surfaceSunken: '#141915',
  textPrimary: '#E9F0EA',
  textSecondary: '#AFB9B1',
  textMuted: '#7C867E',
  textInverse: '#121613',
  accent: '#93C2A4',
  accentMuted: '#2B3A2F',
  accentText: '#C4E2CE',
  primary: '#93C2A4',
  primaryText: '#121613',
  border: '#2A332C',
  divider: '#222A24',
  success: '#6FB48C',
  danger: '#E08A8A',
  dangerText: '#121613',
  overlay: 'rgba(0,0,0,0.55)',
  moodVeryLow: '#E08A8A',
  moodLow: '#E0AE85',
  moodOkay: '#E8CD87',
  moodGood: '#93C2A4',
  moodGreat: '#6FB48C',
  graphEmotion: '#E08A8A',
  graphSituation: '#6FA8DC',
  graphPerson: '#84C29A',
  graphBelief: '#6577C0',
  graphBehavior: '#E0BE72',
  graphDistortion: '#6FC2C9',
  graphPlace: '#D69A6F',
  graphActivity: '#9AA86F',
  graphEdge: '#6E7A70',
}
