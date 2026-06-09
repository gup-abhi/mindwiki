/**
 * Color tokens. `lightColors` and `darkColors` share an identical key shape so
 * every themed style can read `theme.colors.<role>` and work in both modes.
 * Calm, warm palette evolving the original navy (#1a1a2e) + purple (#7a7ad0).
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
  // Knowledge-graph node colors (centralized so the graph themes consistently).
  graphEmotion: string
  graphSituation: string
  graphPerson: string
  graphBelief: string
  graphBehavior: string
  graphDistortion: string
  graphPlace: string
  graphActivity: string
}

export const lightColors: ColorTokens = {
  bg: '#FBF8F4',
  surface: '#FFFFFF',
  surfaceAlt: '#F4F1FA',
  surfaceSunken: '#EFEAF6',
  textPrimary: '#26233A',
  textSecondary: '#6B6880',
  textMuted: '#9A97AE',
  textInverse: '#FFFFFF',
  accent: '#8A86D6',
  accentMuted: '#E6E4F7',
  accentText: '#4A4783',
  primary: '#2E2B45',
  primaryText: '#FFFFFF',
  border: '#ECE7F0',
  divider: '#F0ECF4',
  success: '#4F8A6B',
  danger: '#C75D5D',
  dangerText: '#FFFFFF',
  overlay: 'rgba(38,35,58,0.35)',
  graphEmotion: '#E08A8A',
  graphSituation: '#6FA8DC',
  graphPerson: '#84C29A',
  graphBelief: '#B98AD6',
  graphBehavior: '#E0BE72',
  graphDistortion: '#6FC2C9',
  graphPlace: '#D69A6F',
  graphActivity: '#9AA86F',
}

export const darkColors: ColorTokens = {
  bg: '#14131C',
  surface: '#1E1C29',
  surfaceAlt: '#262333',
  surfaceSunken: '#16151E',
  textPrimary: '#ECEAF4',
  textSecondary: '#B4B0C6',
  textMuted: '#807C94',
  textInverse: '#14131C',
  accent: '#A6A2E6',
  accentMuted: '#2E2B45',
  accentText: '#C9C6F2',
  primary: '#A6A2E6',
  primaryText: '#14131C',
  border: '#2C2A3A',
  divider: '#242233',
  success: '#6FB48C',
  danger: '#E08A8A',
  dangerText: '#14131C',
  overlay: 'rgba(0,0,0,0.55)',
  graphEmotion: '#E08A8A',
  graphSituation: '#6FA8DC',
  graphPerson: '#84C29A',
  graphBelief: '#B98AD6',
  graphBehavior: '#E0BE72',
  graphDistortion: '#6FC2C9',
  graphPlace: '#D69A6F',
  graphActivity: '#9AA86F',
}
