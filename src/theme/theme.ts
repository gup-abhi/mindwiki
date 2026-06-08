import { type ColorTokens, lightColors, darkColors } from './colors'
import { type ColorScheme } from './scheme'
import { makeShadows, type Shadows } from './shadows'
import { spacing, radii, type Spacing, type Radii } from './spacing'
import { typography, fontFamily, type Typography } from './typography'

export interface Theme {
  scheme: ColorScheme
  /** StatusBar `style` for this theme (opposite of the background). */
  statusBar: ColorScheme
  colors: ColorTokens
  spacing: Spacing
  radii: Radii
  typography: Typography
  fontFamily: typeof fontFamily
  shadows: Shadows
}

export const lightTheme: Theme = {
  scheme: 'light',
  statusBar: 'dark',
  colors: lightColors,
  spacing,
  radii,
  typography,
  fontFamily,
  shadows: makeShadows('light'),
}

export const darkTheme: Theme = {
  scheme: 'dark',
  statusBar: 'light',
  colors: darkColors,
  spacing,
  radii,
  typography,
  fontFamily,
  shadows: makeShadows('dark'),
}

export const themeFor = (scheme: ColorScheme): Theme => (scheme === 'dark' ? darkTheme : lightTheme)
