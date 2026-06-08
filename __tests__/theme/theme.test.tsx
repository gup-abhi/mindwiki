import { fireEvent, render, renderHook, screen } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'
import * as RN from 'react-native'

import {
  ThemeProvider,
  useTheme,
  useThemePreference,
  useThemedStyles,
  lightTheme,
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

describe('theme', () => {
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
