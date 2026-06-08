export type ColorScheme = 'light' | 'dark'
export type ThemePreference = 'system' | 'light' | 'dark'

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark'
}
