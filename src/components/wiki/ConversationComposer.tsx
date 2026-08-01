import { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { IconButton } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

interface Props {
  sending: boolean
  onSend: (text: string) => void
  /** When this changes, pre-fill the field with its text and focus it (e.g. from
   *  a feeling chip). The nonce makes re-tapping the same text re-seed/refocus. */
  seed?: { text: string; nonce: number } | null
}

// Grows from one line up to a few, then scrolls internally.
const MIN_HEIGHT = 44
const MAX_HEIGHT = 120

/**
 * Bottom composer: an auto-growing, wrapping text field + send button. The input
 * is multiline so long messages wrap and the field expands with the content
 * (capped at MAX_HEIGHT, then it scrolls). Disabled while a reply streams.
 */
export function ConversationComposer({ sending, onSend, seed }: Props) {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const inputRef = useRef<TextInput>(null)
  const [text, setText] = useState('')
  const [height, setHeight] = useState(MIN_HEIGHT)

  // Pre-fill the field and focus it, so a chip tap drops the user straight into
  // an editable message rather than a blank box. Does not send.
  useEffect(() => {
    if (!seed) return
    setText(seed.text)
    inputRef.current?.focus()
  }, [seed])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    onSend(trimmed)
    setText('')
    setHeight(MIN_HEIGHT) // collapse back to one line after sending
  }

  return (
    <View style={styles.row}>
      <TextInput
        ref={inputRef}
        style={[styles.input, { height }]}
        value={text}
        onChangeText={setText}
        onContentSizeChange={(e) =>
          setHeight(
            Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, e.nativeEvent.contentSize.height))
          )
        }
        placeholder="Share what’s on your mind…"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="noExcludeDescendants"
        multiline
        editable={!sending}
        testID="composer-input"
      />
      <IconButton
        name="send"
        color="accent"
        accessibilityLabel="Send message"
        onPress={submit}
        testID="composer-send"
      />
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end', // send button sits at the bottom as the input grows
      gap: t.spacing.sm,
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.md,
    },
    input: {
      flex: 1,
      maxHeight: MAX_HEIGHT,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: t.radii.md,
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.sm + 2,
      fontSize: t.typography.body.fontSize,
      fontFamily: t.fontFamily.serifRegular,
      color: t.colors.textPrimary,
      backgroundColor: t.colors.surface,
      textAlignVertical: 'top', // Android: start text at the top, not vertically centered
    },
  })
