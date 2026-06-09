import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'

import { Button, Card, Chip, IconButton, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { useWikiQuery } from '@/hooks/useWikiQuery'

export default function QueryScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const { q } = useLocalSearchParams<{ q?: string }>()
  const initial = typeof q === 'string' ? q : undefined
  const { suggestions, recentPages, answer, related, asking, ask, clear } = useWikiQuery(initial)
  const [text, setText] = useState(initial ?? '')

  const submit = (q: string) => {
    setText(q)
    ask(q)
  }

  // Reset the field and the answer, back to the suggestions view.
  const clearQuestion = () => {
    setText('')
    clear()
  }
  const canClear = text.length > 0 || answer !== null

  return (
    <Screen scroll>
      <Text variant="title">Ask your wiki</Text>
      <Text variant="caption" color="textMuted" style={styles.subtitle}>
        Answers come only from your own journal.
      </Text>

      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <TextField
            placeholder="Ask a question…"
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => submit(text)}
            returnKeyType="search"
          />
        </View>
        {canClear && (
          <IconButton
            name="close-circle"
            color="textMuted"
            accessibilityLabel="Clear question"
            onPress={clearQuestion}
            testID="query-clear"
          />
        )}
      </View>
      {!answer && (
        <View style={styles.askRow}>
          <Button title="Ask" fullWidth onPress={() => submit(text)} />
        </View>
      )}

      {asking && <ActivityIndicator style={styles.spinner} color={theme.colors.accent} />}

      {answer && !asking && (
        <Card style={styles.answerCard}>
          <Text variant="body">{answer.answer}</Text>
          {answer.sources.length > 0 && (
            <>
              <Text variant="caption" color="textMuted" style={styles.evidence}>
                Drawn from {answer.sources.length}{' '}
                {answer.sources.length === 1 ? 'page' : 'pages'} · {answer.evidenceCount}{' '}
                {answer.evidenceCount === 1 ? 'entry' : 'entries'}
              </Text>
              <View style={styles.chips}>
                {answer.sources.map((p) => (
                  <Chip key={p.id} label={p.title} onPress={() => router.push(`/wiki/${p.id}`)} />
                ))}
              </View>
              <Pressable accessibilityRole="button" onPress={() => router.push('/graph')}>
                <Text variant="label" color="accent" style={styles.explore}>
                  Explore in graph →
                </Text>
              </Pressable>
            </>
          )}
        </Card>
      )}

      {answer && !asking && related.length > 0 && (
        <View style={styles.section}>
          <Text variant="label" color="accent" style={styles.sectionLabel}>
            Entries behind this
          </Text>
          {related.map((e) => (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              style={styles.entryRow}
              onPress={() => router.push(`/entries/${e.id}`)}
            >
              <Text variant="caption" color="accent" style={styles.entryDate}>
                {new Date(e.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
              <Text variant="body" style={styles.entrySnippet} numberOfLines={1}>
                {e.situation}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {!answer && !asking && suggestions.length > 0 && (
        <View style={styles.section}>
          <Text variant="label" color="accent" style={styles.sectionLabel}>
            Try asking
          </Text>
          {suggestions.map((q) => (
            <Card key={q} variant="sunken" style={styles.suggestion} onPress={() => submit(q)}>
              <Text variant="body">{q}</Text>
            </Card>
          ))}
        </View>
      )}

      {!answer && !asking && recentPages.length > 0 && (
        <View style={styles.section}>
          <Text variant="label" color="accent" style={styles.sectionLabel}>
            Recent pages
          </Text>
          <View style={styles.chips}>
            {recentPages.map((p) => (
              <Chip key={p.id} label={p.title} onPress={() => router.push(`/wiki/${p.id}`)} />
            ))}
          </View>
        </View>
      )}
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    subtitle: { marginTop: t.spacing.xs, marginBottom: t.spacing.lg },
    searchRow: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' },
    searchInput: { flex: 1 },
    askRow: { marginTop: t.spacing.md },
    spinner: { marginTop: t.spacing['2xl'] },
    answerCard: { marginTop: t.spacing.lg },
    evidence: { marginTop: t.spacing.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm, marginTop: t.spacing.sm },
    explore: { marginTop: t.spacing.md },
    section: { marginTop: t.spacing['2xl'] },
    sectionLabel: { marginBottom: t.spacing.sm },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.md,
      paddingVertical: t.spacing.md,
      paddingHorizontal: t.spacing.md,
      backgroundColor: t.colors.surfaceSunken,
      borderRadius: t.radii.md,
      marginBottom: t.spacing.sm,
    },
    entryDate: { width: 48 },
    entrySnippet: { flex: 1 },
    suggestion: { marginBottom: t.spacing.sm },
  })
