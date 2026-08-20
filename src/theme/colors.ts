/**
 * Color tokens. `lightColors` and `darkColors` share an identical key shape so
 * every themed style can read `theme.colors.<role>` and work in both modes.
 * Warm editorial neutrals with restrained teal interaction and indigo knowledge
 * accents. Color supports hierarchy and provenance; it does not prescribe mood.
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
  knowledge: string
  knowledgeMuted: string
  knowledgeText: string
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
  textSecondary: '#52605A',
  textMuted: '#5E6B64',
  textInverse: '#FFFFFF',
  accent: '#2D6965',
  accentMuted: '#DCEBE7',
  accentText: '#245650',
  primary: '#245650',
  primaryText: '#FFFFFF',
  border: '#D8E1DB',
  divider: '#E5EBE6',
  success: '#28724F',
  danger: '#A13D3D',
  dangerText: '#FFFFFF',
  knowledge: '#5C5F91',
  knowledgeMuted: '#E5E5F3',
  knowledgeText: '#454873',
  overlay: 'rgba(34,43,37,0.35)',
  moodVeryLow: '#B85C5C',
  moodLow: '#C98A68',
  moodOkay: '#C7A45E',
  moodGood: '#6FA77F',
  moodGreat: '#3C8062',
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
  bg: '#121718',
  surface: '#1B211C',
  surfaceAlt: '#242B25',
  surfaceSunken: '#141915',
  textPrimary: '#E9F0EA',
  textSecondary: '#B6C2BB',
  textMuted: '#A1B0A8',
  textInverse: '#121718',
  accent: '#79BBB3',
  accentMuted: '#24433F',
  accentText: '#A9D8D1',
  primary: '#79BBB3',
  primaryText: '#121718',
  border: '#344241',
  divider: '#293635',
  success: '#79C49A',
  danger: '#EF8C8C',
  dangerText: '#121718',
  knowledge: '#A9ACE0',
  knowledgeMuted: '#343655',
  knowledgeText: '#D5D6F4',
  overlay: 'rgba(0,0,0,0.55)',
  moodVeryLow: '#D98282',
  moodLow: '#D6A27D',
  moodOkay: '#D6BD76',
  moodGood: '#84B996',
  moodGreat: '#69A987',
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
