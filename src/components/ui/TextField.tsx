import { useId } from 'react'
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type TextStyle } from 'react-native'

import { type Theme, useTheme, useThemedStyles } from '@/theme'

import { Text } from './Text'

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string
  error?: string
  /** Disable keyboard learning, correction, and autofill for private writing. */
  sensitive?: boolean
  style?: StyleProp<TextStyle>
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: t.spacing.sm },
    input: {
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: t.radii.md,
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md + 2,
      fontSize: t.typography.body.fontSize,
      fontFamily: t.fontFamily.serifRegular,
      color: t.colors.textPrimary,
      backgroundColor: t.colors.surface,
    },
    multiline: { minHeight: 120, textAlignVertical: 'top' },
    errorBorder: { borderColor: t.colors.danger },
  })

/** Themed text input with optional label + error. */
export function TextField({ label, error, multiline, scrollEnabled, sensitive = false, style, ...rest }: TextFieldProps) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const fieldId = useId().replace(/:/g, '')
  const labelId = `text-field-label-${fieldId}`
  const errorId = `text-field-error-${fieldId}`
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text nativeID={labelId} variant="label" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        {...rest}
        accessibilityLabelledBy={[label ? labelId : null, error ? errorId : null].filter((value): value is string => value !== null)}
        accessibilityState={{ disabled: rest.editable === false }}
        autoCorrect={sensitive ? false : rest.autoCorrect}
        spellCheck={sensitive ? false : rest.spellCheck}
        autoComplete={sensitive ? 'off' : rest.autoComplete}
        textContentType={sensitive ? 'none' : rest.textContentType}
        importantForAutofill={sensitive ? 'noExcludeDescendants' : rest.importantForAutofill}
        multiline={multiline}
        // A multiline input defaults to its own internal scroll, which fights a
        // parent ScrollView for the touch responder on Android (New Arch) — the
        // field becomes barely tappable. Disable it so the page scrolls and the
        // field just grows; callers can still opt back in.
        scrollEnabled={scrollEnabled ?? (multiline ? false : undefined)}
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, multiline && styles.multiline, error ? styles.errorBorder : null, style]}
      />
      {error ? (
        <Text nativeID={errorId} accessibilityLiveRegion="polite" variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  )
}
