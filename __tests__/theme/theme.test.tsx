import { fireEvent, render, renderHook, screen } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'
import * as RN from 'react-native'

import {
  ThemeProvider,
  useTheme,
  useThemePreference,
  useThemedStyles,
  lightTheme,
  darkTheme,
  type Theme,
} from '@/theme'

jest.mock('@/services/storage/settings', () => ({
  getSetting: jest.fn(async () => ({ success: true, data: null })),
  setSetting: jest.fn(async () => ({ success: true, data: undefined })),
}))

function Probe() {
  const theme = useTheme()
  const { preference, setPreference } = useThemePreference()
  return (
    <>
      <Text testID="scheme">{theme.scheme}</Text>
      <Text testID="pref">{preference}</Text>
      <Pressable testID="to-dark" onPress={() => setPreference('dark')}>
        <Text>d</Text>
      </Pressable>
    </>
  )
}

const schemeOf = () => screen.getByTestId('scheme').props.children

afterEach(() => jest.restoreAllMocks())

const luminance = (hex: string) => {
  const channels = hex.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16) / 255)
  if (!channels || channels.length !== 3) throw new Error(`Expected #RRGGBB, received ${hex}`)
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (foreground: string, background: string) => {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('theme', () => {
  it('keeps semantic color roles aligned and contrast-safe', () => {
    const lightKeys = Object.keys(lightTheme.colors).sort()
    expect(Object.keys(darkTheme.colors).sort()).toEqual(lightKeys)
    expect(lightTheme.colors.knowledge).toBeTruthy()
    expect(darkTheme.colors.knowledge).toBeTruthy()

    for (const theme of [lightTheme, darkTheme]) {
      const surfaces = [theme.colors.bg, theme.colors.surface, theme.colors.surfaceAlt, theme.colors.surfaceSunken]
      for (const surface of surfaces) {
        expect(contrast(theme.colors.textPrimary, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme.colors.textSecondary, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme.colors.textMuted, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme.colors.accent, surface)).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(theme.colors.primaryText, theme.colors.primary)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.colors.accentText, theme.colors.accentMuted)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.colors.dangerText, theme.colors.danger)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.colors.knowledgeText, theme.colors.knowledgeMuted)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('uses the warm paper light theme and distinct knowledge accent', () => {
    expect(lightTheme.colors.bg).toBe('#FBF8F4')
    expect(lightTheme.colors.accent).toBe('#2D6965')
    expect(lightTheme.colors.knowledge).not.toBe(lightTheme.colors.accent)
  })

  it('uses a separately designed dark theme', () => {
    expect(darkTheme.colors.bg).toBe('#121718')
    expect(darkTheme.colors.knowledge).toBe('#A9ACE0')
  })

  it('useTheme defaults to light with no provider mounted', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current).toBe(lightTheme)
    expect(result.current.scheme).toBe('light')
  })

  it('follows the system scheme when preference is "system"', () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(schemeOf()).toBe('dark')
  })

  it('an explicit preference overrides the system scheme', () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(schemeOf()).toBe('light')
    fireEvent.press(screen.getByTestId('to-dark'))
    expect(schemeOf()).toBe('dark')
  })

  it('useThemedStyles builds styles from the active theme', () => {
    const make = (t: Theme) => ({ box: { backgroundColor: t.colors.surface } })
    const { result } = renderHook(() => useThemedStyles(make))
    expect(result.current.box.backgroundColor).toBe(lightTheme.colors.surface)
  })
})
