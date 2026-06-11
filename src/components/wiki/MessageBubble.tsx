import React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type UIMessage } from '@/store/chat.store'

import { CrisisBanner } from './CrisisBanner'
import { SourceChips } from './SourceChips'

function MessageBubbleBase({
  message,
  onRetry,
}: {
  message: UIMessage
  onRetry?: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const isUser = message.role === 'user'
  return (
    <View style={isUser ? styles.userWrap : styles.assistantWrap}>
      <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
        <Text variant="body" color={isUser ? 'primaryText' : 'textPrimary'}>
          {message.content}
        </Text>
      </View>
      {message.sources.length > 0 && <SourceChips sources={message.sources} />}
      {message.crisisTier != null && message.crisisTier > 0 && <CrisisBanner />}
      {message.failed && onRetry && (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retry}
          testID="retry"
        >
          <Text variant="label" color="accent">
            Try again
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/** One chat turn. Memoized — only re-renders when its message changes. */
export const MessageBubble = React.memo(MessageBubbleBase)

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    userWrap: { alignItems: 'flex-end', marginBottom: t.spacing.md },
    assistantWrap: { alignItems: 'flex-start', marginBottom: t.spacing.md },
    bubble: {
      maxWidth: '85%',
      paddingVertical: t.spacing.md,
      paddingHorizontal: t.spacing.lg,
      borderRadius: t.radii.lg,
    },
    user: { backgroundColor: t.colors.accent },
    assistant: { backgroundColor: t.colors.surfaceAlt },
    retry: { marginTop: t.spacing.xs, paddingVertical: t.spacing.xs },
  })
