import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'

import { Card, Chip, IconButton, Screen, SegmentedControl, Text } from '@/components/ui'
import { ConversationComposer } from '@/components/wiki/ConversationComposer'
import { MessageBubble } from '@/components/wiki/MessageBubble'
import { TypingIndicator } from '@/components/wiki/TypingIndicator'
import { useConversation } from '@/hooks/useConversation'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useChatStore } from '@/store/chat.store'
import { getHintSeen, markHintSeen } from '@/services/onboarding/first-run'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { CRISIS_RESOURCES } from '@/services/crisis/resources'
import { GUIDED_PATHS } from '@/lib/guided-paths'
import { type Theme, useThemedStyles } from '@/theme'

// Feeling/struggle chips that seed the composer, so the user can start by naming
// what's going on right now instead of facing a blank box. A fixed, curated set —
// these capture the *current* feeling, which may differ from past wiki patterns.
const FEELING_CHIPS: { label: string; seed: string }[] = [
  { label: 'Anxious', seed: 'I’ve been feeling anxious lately.' },
  { label: 'Overwhelmed', seed: 'I’ve been feeling overwhelmed lately.' },
  { label: 'Low', seed: 'I’ve been feeling low lately.' },
  { label: 'Stuck', seed: 'I feel stuck right now.' },
  { label: 'Work', seed: 'I’ve been struggling with work lately.' },
  { label: 'Relationships', seed: 'Something in a relationship is weighing on me.' },
  { label: 'Sleep', seed: 'My sleep has been off lately.' },
]

export default function QueryScreen() {
  const styles = useThemedStyles(makeStyles)
  const reducedMotion = useReducedMotion()
  const { messages, sending, suggestions, history, send, retry, openStarter, newConversation, loadConversation } =
    useConversation()
  const summaryCrisisTier = useChatStore((s) => s.summaryCrisisTier)
  const scrollRef = useRef<ScrollView>(null)
  const savedScrollY = useRef(0)
  const userScrolling = useRef(false)
  const [composerSeed, setComposerSeed] = useState<{ text: string; nonce: number } | null>(null)
  const router = useRouter()
  const isEmpty = messages.length === 0
  const [tab, setTab] = useState<'start' | 'history' | 'paths'>('start')
  // One-time Reflect-tab intro hint (P8). null while checking; false → show; true → hide.
  const [reflectHint, setReflectHint] = useState<boolean | null>(null)

  // Resolve the hint once the deep model is ready (don't advertise before models).
  useEffect(() => {
    let active = true
    void (async () => {
      const done = await getHintSeen('reflect_intro').catch(() => false)
      if (!active) return
      if (done) {
        if (active) setReflectHint(true)
        return
      }
      // Only show once the deep model is present (don't advertise a broken door).
      const ready = await isModelDownloaded('deep').catch(() => false)
      if (active) setReflectHint(ready)
    })()
    return () => { active = false }
  }, [])

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

  // Re-pin when a conversation loads, a turn is added, or pending state changes — but only
  // inside an active thread, never on the start screen (which shows suggestions
  // and history in descending order and shouldn't scroll to bottom).
  useEffect(() => {
    if (!isEmpty) scrollToBottom()
  }, [messages, sending, scrollToBottom, isEmpty])

  // Save the start screen's scroll position before entering a conversation,
  // and restore it when returning. Without this, closing a conversation resets
  // the history/suggestions list to the top — disorienting when the user was
  // scrolled deep into their past conversations.
  //
  // A ref tracks whether the current scroll event came from a user drag (vs a
  // programmatic reflow-settle when content shrinks on chat exit). Content-shrink
  // events fire at y=0 while isEmpty is already true and would clobber the real
  // saved position, so only capture during user-initiated scroll phases.
  const onStartScrollBeginDrag = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      userScrolling.current = true
      if (isEmpty) savedScrollY.current = e.nativeEvent.contentOffset.y
    },
    [isEmpty]
  )
  const onStartScrollEndDrag = useCallback(() => {
    userScrolling.current = false
  }, [])
  const onStartMomentumScrollEnd = useCallback(() => {
    userScrolling.current = false
  }, [])
  const onStartScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      if (isEmpty && userScrolling.current) {
        savedScrollY.current = e.nativeEvent.contentOffset.y
      }
    },
    [isEmpty]
  )
  const restoreScroll = useCallback(() => {
    if (!isEmpty) return
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, savedScrollY.current), animated: false }))
    )
  }, [isEmpty])
  // Restore after the start screen content (history list, suggestions) renders.
  useEffect(() => {
    if (isEmpty && history.length > 0) restoreScroll()
  }, [history, tab, isEmpty, restoreScroll])

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
          onScroll={isEmpty ? onStartScroll : undefined}
          scrollEventThrottle={16}
          onScrollBeginDrag={isEmpty ? onStartScrollBeginDrag : undefined}
          onScrollEndDrag={isEmpty ? onStartScrollEndDrag : undefined}
          onMomentumScrollEnd={isEmpty ? onStartMomentumScrollEnd : undefined}
          onContentSizeChange={isEmpty ? undefined : scrollToBottom}
        >
          {isEmpty ? (
            <View>
              <Text variant="body" color="textSecondary" style={styles.intro}>
                A private space to talk things through. When a reply draws on your wiki, its source pages appear below the reply.
              </Text>

              {reflectHint === false && (
                <Card variant="sunken" style={styles.hintCard} testID="reflect-intro-hint">
                  <View style={styles.hintRow}>
                    <Text variant="caption" color="textSecondary" style={styles.hintText}>
                      Reflect is your private companion — try one of the feeling chips below to start.
                    </Text>
                    <Chip
                      label="Got it"
                      onPress={() => {
                        setReflectHint(true)
                        void markHintSeen('reflect_intro')
                      }}
                      testID="reflect-intro-dismiss"
                    />
                  </View>
                </Card>
              )}

              <SegmentedControl
                options={[
                  { key: 'start', label: 'Start', testID: 'tab-start' },
                  { key: 'history', label: 'History', testID: 'tab-history' },
                  { key: 'paths', label: 'Paths', testID: 'tab-paths' },
                ]}
                selectedKey={tab}
                onChange={(key) => setTab(key as 'start' | 'history' | 'paths')}
                testID="reflect-tabs"
              />

              {tab === 'start' ? (
                <View>
                  <Text variant="label" color="accent" style={styles.sectionLabel}>
                    What’s weighing on you lately?
                  </Text>
                  <View style={styles.chips}>
                    {FEELING_CHIPS.map((c) => (
                      <Pressable
                        key={c.label}
                        accessibilityRole="button"
                        accessibilityLabel={`Start a chat: ${c.label}`}
                        style={styles.chip}
                        onPress={() =>
                          setComposerSeed((s) => ({ text: c.seed, nonce: (s?.nonce ?? 0) + 1 }))
                        }
                        testID={`feeling-chip-${c.label}`}
                      >
                        <Text variant="label" color="textSecondary">
                          {c.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable
                    style={styles.untangleCard}
                    onPress={() => router.push('/untangle')}
                    accessibilityRole="button"
                    accessibilityLabel="Untangle a thought, five-step reflection exercise"
                    testID="untangle-entry"
                  >
                    <Text variant="label" color="accent">
                      🧩 Untangle a thought
                    </Text>
                    <Text variant="caption" color="textMuted">
                      Untangle a difficult thought, one step at a time.
                    </Text>
                  </Pressable>

                  {suggestions.length > 0 && (
                    <View style={styles.exploreSection}>
                      <Text variant="label" color="accent" style={styles.sectionLabel}>
                        Or explore a pattern
                      </Text>
                      {suggestions.map((q) => (
                        <Card
                          key={q}
                          variant="sunken"
                          style={styles.suggestion}
                          onPress={() => openStarter(q)}
                        >
                          <Text variant="body">{q}</Text>
                        </Card>
                      ))}
                    </View>
                  )}
                </View>
              ) : tab === 'paths' ? (
                <View style={styles.pathsContainer}>
                  <Text variant="label" color="accent" style={styles.sectionLabel}>
                    Guided reflections
                  </Text>
                  <Text variant="body" color="textSecondary" style={styles.pathsIntro}>
                    A few gentle prompts to work through, one at a time. Whatever you write feeds your wiki.
                  </Text>
                  {GUIDED_PATHS.map((path) => (
                    <Card
                      key={path.id}
                      variant="surface"
                      style={styles.pathCard}
                      onPress={() => router.push(`/paths/${path.id}`)}
                      testID={`path-${path.id}`}
                    >
                      <Text variant="heading">{path.title}</Text>
                      <Text variant="body" color="textSecondary" style={styles.pathCardDesc}>
                        {path.description}
                      </Text>
                      <Text variant="caption" color="textMuted" style={styles.pathCardMeta}>
                        {path.steps.length} prompts
                      </Text>
                    </Card>
                  ))}
                </View>
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
            messages.map((m) => (
              <MessageBubble key={m.id} message={m} reducedMotion={reducedMotion} onRetry={retry} />
            ))
          )}

          {sending && <TypingIndicator />}
        </ScrollView>

        {!isEmpty && summaryCrisisTier > 0 && (
          <View style={styles.crisisResourceStrip}>
            <Text variant="caption" color="textSecondary" style={styles.crisisResourceText}>
              Things feel heavy. If you need support, {CRISIS_RESOURCES[0].contact} — free, 24/7.
            </Text>
          </View>
        )}

        <ConversationComposer sending={sending} onSend={send} seed={composerSeed} />
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
    hintCard: { marginBottom: t.spacing.md },
    hintRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
    hintText: { flex: 1 },
    sectionLabel: { marginBottom: t.spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
    chip: {
      minHeight: 48,
      justifyContent: 'center',
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.lg,
      borderRadius: t.radii.pill,
      backgroundColor: t.colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    untangleCard: {
      marginTop: t.spacing.xl,
      padding: t.spacing.md,
      backgroundColor: t.colors.accentMuted,
      borderRadius: t.radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.accent,
      gap: t.spacing.xs,
    },
    exploreSection: { marginTop: t.spacing.xl },
    suggestion: { marginBottom: t.spacing.sm, borderColor: t.colors.border },
    historyRow: {
      minHeight: 48,
      justifyContent: 'center',
      paddingVertical: t.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.divider,
    },
    historyDate: { marginTop: t.spacing.xs },
    pathsContainer: { marginTop: t.spacing.md },
    pathsIntro: { marginBottom: t.spacing.lg },
    pathCard: { marginBottom: t.spacing.md },
    pathCardDesc: { marginTop: t.spacing.xs },
    pathCardMeta: { marginTop: t.spacing.sm },
    crisisResourceStrip: {
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.lg,
      backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radii.md,
      marginBottom: t.spacing.sm,
    },
    crisisResourceText: { textAlign: 'center' },
  })
