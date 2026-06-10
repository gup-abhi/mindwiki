import { useRef } from 'react'
import { useLocalSearchParams } from 'expo-router'
import {
  ActivityIndicator,
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
  const { messages, streaming, sending, suggestions, history, send, newConversation, loadConversation } =
    useConversation(initial)
  const scrollRef = useRef<ScrollView>(null)
  const isEmpty = messages.length === 0

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
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {isEmpty ? (
            <View>
              <Text variant="body" color="textSecondary" style={styles.intro}>
                A private space to talk things through — grounded only in your own wiki.
              </Text>

              {suggestions.length > 0 && (
                <View style={styles.section}>
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
              )}

              {history.length > 0 && (
                <View style={styles.section}>
                  <Text variant="label" color="accent" style={styles.sectionLabel}>
                    Past conversations
                  </Text>
                  {history.map((c) => (
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
                  ))}
                </View>
              )}
            </View>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
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
    intro: { marginBottom: t.spacing.xl },
    section: { marginTop: t.spacing.xl },
    sectionLabel: { marginBottom: t.spacing.sm },
    suggestion: { marginBottom: t.spacing.sm },
    historyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: t.spacing.md,
    },
    historyDate: { marginLeft: t.spacing.md },
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
