import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { IconButton, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'

interface Props {
  sending: boolean
  onSend: (text: string) => void
}

/** Bottom composer: a text field + send button. Disabled while a reply streams. */
export function ConversationComposer({ sending, onSend }: Props) {
  const styles = useThemedStyles(makeStyles)
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    onSend(trimmed)
    setText('')
  }

  return (
    <View style={styles.row}>
      <View style={styles.input}>
        <TextField
          placeholder="Share what’s on your mind…"
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="send"
          editable={!sending}
          testID="composer-input"
        />
      </View>
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
      alignItems: 'center',
      gap: t.spacing.sm,
      paddingTop: t.spacing.sm,
    },
    input: { flex: 1 },
  })
