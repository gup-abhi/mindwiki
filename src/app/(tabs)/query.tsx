import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router'
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'

import { Card, IconButton, Screen, Text } from '@/components/ui'
import { ConversationComposer } from '@/components/wiki/ConversationComposer'
import { MessageBubble } from '@/components/wiki/MessageBubble'
import { useConversation } from '@/hooks/useConversation'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

export default function QueryScreen() {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const { q } = useLocalSearchParams<{ q?: string }>()
  const initial = typeof q === 'string' ? q : undefined
  const { messages, streaming, sending, suggestions, history, send, retry, newConversation, loadConversation } =
    useConversation(initial)
  const scrollRef = useRef<ScrollView>(null)
  const isEmpty = messages.length === 0
  const [tab, setTab] = useState<'start' | 'history'>('start')

  // Tapping the Reflect tab always returns to the start screen (suggestions +
  // past conversations) — but returning from a pushed page (e.g. a source chip
  // → wiki page) does NOT, so an open conversation is preserved in that flow.
  // `tabPress` is a bottom-tabs event not in the default navigation type.
  const navigation = useNavigation() as unknown as {
    addListener: (event: 'tabPress', callback: () => void) => () => void
  }
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => newConversation())
    return unsub
  }, [navigation, newConversation])

  // Pin the thread to the bottom. Deferred past layout/paint with rAF — a
  // synchronous scroll runs before freshly rendered content is measured, so it
  // lands short on a long, just-opened conversation.
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }))
    )
  }, [])

  // Re-pin when a conversation loads, a turn is added, or a reply streams in.
  useEffect(() => {
    scrollToBottom()
  }, [messages, streaming, scrollToBottom])

  // Android hardware back: when a conversation is open, return to the Reflect
  // start screen instead of leaving to Home. On the start screen, let the
  // default navigation happen.
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (!isEmpty) {
          newConversation()
          return true // handled — stay on the Reflect tab
        }
        return false // start screen — default back (to Home)
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack)
      return () => sub.remove()
    }, [isEmpty, newConversation])
  )

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text variant="title">Reflect</Text>
        {!isEmpty && (
          <IconButton
            name="create-outline"
            color="accent"
            accessibilityLabel="New conversation"
            onPress={newConversation}
            testID="new-conversation"
          />
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToBottom}
        >
          {isEmpty ? (
            <View>
              <Text variant="body" color="textSecondary" style={styles.intro}>
                A private space to talk things through — grounded only in your own wiki.
              </Text>

              <View style={styles.segments}>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.segment, tab === 'start' && styles.segmentActive]}
                  onPress={() => setTab('start')}
                  testID="tab-start"
                >
                  <Text variant="label" color={tab === 'start' ? 'primaryText' : 'textSecondary'}>
                    Start
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.segment, tab === 'history' && styles.segmentActive]}
                  onPress={() => setTab('history')}
                  testID="tab-history"
                >
                  <Text variant="label" color={tab === 'history' ? 'primaryText' : 'textSecondary'}>
                    History
                  </Text>
                </Pressable>
              </View>

              {tab === 'start' ? (
                suggestions.length > 0 ? (
                  <View>
                    <Text variant="label" color="accent" style={styles.sectionLabel}>
                      Try starting with
                    </Text>
                    {suggestions.map((q) => (
                      <Card
                        key={q}
                        variant="sunken"
                        style={styles.suggestion}
                        onPress={() => send(q)}
                      >
                        <Text variant="body">{q}</Text>
                      </Card>
                    ))}
                  </View>
                ) : (
                  <Text variant="body" color="textMuted">
                    Type a message below to start reflecting.
                  </Text>
                )
              ) : history.length > 0 ? (
                history.map((c) => (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    style={styles.historyRow}
                    onPress={() => loadConversation(c.id)}
                  >
                    <Text variant="body" numberOfLines={1}>
                      {c.title ?? 'Conversation'}
                    </Text>
                    <Text variant="caption" color="textMuted" style={styles.historyDate}>
                      {new Date(c.updated_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text variant="body" color="textMuted">
                  No past conversations yet.
                </Text>
              )}
            </View>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} onRetry={retry} />)
          )}

          {sending && streaming.length > 0 && (
            <View style={styles.assistantWrap}>
              <View style={styles.streamBubble}>
                <Text variant="body">{streaming}</Text>
              </View>
            </View>
          )}
          {sending && streaming.length === 0 && (
            <ActivityIndicator style={styles.spinner} color={theme.colors.accent} />
          )}
        </ScrollView>

        <ConversationComposer sending={sending} onSend={send} />
      </KeyboardAvoidingView>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: t.spacing.md,
    },
    scrollContent: { paddingBottom: t.spacing.lg },
    intro: { marginBottom: t.spacing.lg },
    segments: {
      flexDirection: 'row',
      backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radii.lg,
      padding: t.spacing.xs,
      marginBottom: t.spacing.xl,
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: t.spacing.sm,
      borderRadius: t.radii.md,
    },
    segmentActive: { backgroundColor: t.colors.accent },
    sectionLabel: { marginBottom: t.spacing.sm },
    suggestion: { marginBottom: t.spacing.sm },
    historyRow: { paddingVertical: t.spacing.md },
    historyDate: { marginTop: t.spacing.xs },
    assistantWrap: { alignItems: 'flex-start', marginBottom: t.spacing.md },
    streamBubble: {
      maxWidth: '85%',
      paddingVertical: t.spacing.md,
      paddingHorizontal: t.spacing.lg,
      borderRadius: t.radii.lg,
      backgroundColor: t.colors.surfaceAlt,
    },
    spinner: { marginTop: t.spacing.lg, alignSelf: 'flex-start' },
  })
