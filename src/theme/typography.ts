/**
 * Type scale + font families. Lora (serif) for reading/journal content, Nunito
 * (rounded sans) for UI chrome. Family names encode weight (custom fonts), so
 * styles set `fontFamily` rather than `fontWeight`. Fonts are loaded in the root
 * layout (see _layout.tsx); until then RN falls back to the system font.
 */
export const fontFamily = {
  // Serif (content)
  serifRegular: 'Lora_400Regular',
  serifMedium: 'Lora_500Medium',
  serifSemibold: 'Lora_600SemiBold',
  serifBold: 'Lora_700Bold',
  // Sans (UI)
  uiRegular: 'Nunito_400Regular',
  uiSemibold: 'Nunito_600SemiBold',
  uiBold: 'Nunito_700Bold',
} as const

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subtitle'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'button'

export interface TypeStyle {
  fontSize: number
  lineHeight: number
  fontFamily: string
}

export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 32, lineHeight: 40, fontFamily: fontFamily.serifBold },
  title: { fontSize: 28, lineHeight: 36, fontFamily: fontFamily.serifBold },
  heading: { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.serifSemibold },
  subtitle: { fontSize: 17, lineHeight: 24, fontFamily: fontFamily.uiSemibold },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.serifRegular },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.serifSemibold },
  label: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.uiSemibold },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.uiRegular },
  button: { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.uiBold },
}

export type Typography = typeof typography
