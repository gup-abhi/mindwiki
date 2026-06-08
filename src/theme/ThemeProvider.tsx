import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { StyleSheet, useColorScheme } from 'react-native'

import { getSetting, setSetting } from '@/services/storage/settings'
import { useAuthStore } from '@/store/auth.store'

import { type ColorScheme, type ThemePreference, isThemePreference } from './scheme'
import { type Theme, lightTheme, themeFor } from './theme'

const PREF_KEY = 'theme_preference'

interface ThemeContextValue {
  theme: Theme
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
}

// Default value lets `useTheme()` work (light) when no provider is mounted —
// keeps existing direct-render tests green without wrapping every one.
const ThemeContext = createContext<ThemeContextValue>({
  theme: lightTheme,
  preference: 'system',
  setPreference: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme()
  const authStatus = useAuthStore((s) => s.status)
  const [preference, setPreferenceState] = useState<ThemePreference>('system')

  // Hydrate the saved preference once the encrypted DB is available (post-auth).
  useEffect(() => {
    if (authStatus !== 'authenticated') return
    let cancelled = false
    void (async () => {
      try {
        const res = await getSetting(PREF_KEY)
        if (!cancelled && res.success && isThemePreference(res.data)) setPreferenceState(res.data)
      } catch {
        // DB not ready — keep the default. Best-effort.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authStatus])

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p)
    try {
      void setSetting(PREF_KEY, p).catch(() => undefined)
    } catch {
      // ignore — persistence is best-effort
    }
  }, [])

  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference
  const theme = themeFor(scheme)

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setPreference }),
    [theme, preference, setPreference]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** The active theme (light when no provider is mounted). */
export function useTheme(): Theme {
  return useContext(ThemeContext).theme
}

/** Current preference + setter, for the Appearance toggle. */
export function useThemePreference(): { preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const { preference, setPreference } = useContext(ThemeContext)
  return { preference, setPreference }
}

/**
 * Build a themed StyleSheet. `factory` should be a module-level const so its
 * reference is stable; styles are memoized and only rebuilt when the theme changes.
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (t: Theme) => T): T {
  const theme = useTheme()
  return useMemo(() => factory(theme), [theme, factory])
}
