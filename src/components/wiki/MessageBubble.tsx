import React, { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { type UIMessage } from '@/store/chat.store'

import { CrisisBanner } from './CrisisBanner'
import { Markdown } from './Markdown'
import { SourceChips } from './SourceChips'

function MessageBubbleBase({
  message,
  reducedMotion,
  onRetry,
}: {
  message: UIMessage
  reducedMotion: boolean
  onRetry?: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const isUser = message.role === 'user'
  const opacity = useSharedValue(message.animateEntry && !reducedMotion ? 0 : 1)
  const translateX = useSharedValue(message.animateEntry && !reducedMotion ? (isUser ? 16 : -16) : 0)

  useEffect(() => {
    if (reducedMotion || !message.animateEntry) {
      opacity.value = 1
      translateX.value = 0
      return
    }
    opacity.value = withTiming(1, { duration: 220 })
    translateX.value = withTiming(0, { duration: 220 })
  }, [message.animateEntry, opacity, reducedMotion, translateX])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }))

  return (
    <Animated.View
      style={[isUser ? styles.userWrap : styles.assistantWrap, animatedStyle]}
      testID={`message-${message.role}`}
    >
      <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
        {isUser ? (
          // The user's own text, shown verbatim.
          <Text variant="body" color="primaryText">
            {message.content}
          </Text>
        ) : (
          // Companion replies are markdown (bold, lists) — render so the **/#/-
          // markers don't show as raw text. Markdown's Text defaults to
          // textPrimary, matching the previous assistant colour.
          <Markdown content={message.content} />
        )}
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
    </Animated.View>
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
    assistant: {
      backgroundColor: t.colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    retry: { marginTop: t.spacing.xs, paddingVertical: t.spacing.xs, minHeight: 48, justifyContent: 'center' },
  })
