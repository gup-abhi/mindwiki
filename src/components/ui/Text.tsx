import { Text as RNText, StyleSheet, type TextProps as RNTextProps, type TextStyle } from 'react-native'

import { type ColorTokens, type TextVariant, type Theme, useThemedStyles } from '@/theme'

interface TextProps extends RNTextProps {
  variant?: TextVariant
  color?: keyof ColorTokens
}

const makeVariantStyles = (t: Theme): Record<TextVariant, TextStyle> =>
  StyleSheet.create(
    Object.fromEntries(
      Object.entries(t.typography).map(([k, v]) => [
        k,
        { fontSize: v.fontSize, lineHeight: v.lineHeight, fontFamily: v.fontFamily },
      ])
    ) as Record<TextVariant, TextStyle>
  )

const makeColorStyles = (t: Theme): Record<keyof ColorTokens, TextStyle> =>
  StyleSheet.create(
    Object.fromEntries(
      (Object.keys(t.colors) as (keyof ColorTokens)[]).map((k) => [k, { color: t.colors[k] }])
    ) as Record<keyof ColorTokens, TextStyle>
  )

/** Typed text: `variant` picks the type scale, `color` picks a theme color token. */
export function Text({ variant = 'body', color = 'textPrimary', style, ...rest }: TextProps) {
  const variants = useThemedStyles(makeVariantStyles)
  const colors = useThemedStyles(makeColorStyles)
  return <RNText {...rest} style={[variants[variant], colors[color], style]} />
}
