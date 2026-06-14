import { useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Alert, StyleSheet, View } from 'react-native'

import { Button, Card, Divider, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { Markdown } from '@/components/wiki/Markdown'
import { useWikiPage } from '@/hooks/useWiki'

const RICHNESS_TARGET = 10 // entries at which the richness bar is full

export default function WikiPageScreen() {
  const styles = useThemedStyles(makeStyles)
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { page, loading, dismiss, restore, correct, regenerate, regenerating } = useWikiPage(id)
  const [draft, setDraft] = useState<string | null>(null) // non-null while editing

  const onRegenerate = async () => {
    const error = await regenerate()
    if (error) {
      Alert.alert(
        'Couldn’t regenerate',
        `${error}\n\nThe rewrite runs the on-device AI model — make sure it has finished downloading, then try again.`
      )
    }
  }

  const confirmDismiss = () => {
    Alert.alert(
      'Drop this insight?',
      'It’ll stop shaping your reflections and won’t come up in conversations. You can restore it anytime, and a new entry on this topic will rebuild it fresh.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Drop it', style: 'destructive', onPress: () => void dismiss() },
      ]
    )
  }

  const saveCorrection = async () => {
    const text = draft?.trim()
    if (!text) return
    await correct(text)
    setDraft(null)
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">
            Loading…
          </Text>
        </View>
      </Screen>
    )
  }
  if (!page) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="body" color="textMuted">
            Page not found
          </Text>
        </View>
      </Screen>
    )
  }

  const history = page.version_history ?? []
  const richness = Math.min(page.entry_count, RICHNESS_TARGET) / RICHNESS_TARGET

  return (
    <Screen scroll>
      <Text variant="title">{page.title}</Text>
      <Text variant="caption" color="textMuted" style={styles.meta}>
        {page.category ?? 'page'} · v{page.version} · {page.entry_count}{' '}
        {page.entry_count === 1 ? 'entry' : 'entries'}
      </Text>

      <View style={styles.richness}>
        <ProgressBar progress={richness} />
      </View>

      <Markdown content={page.content} />

      {history.length > 0 && (
        <View style={styles.history}>
          <Divider />
          <Text variant="label" color="textSecondary" style={styles.historyTitle}>
            {history.length} previous {history.length === 1 ? 'version' : 'versions'}
          </Text>
          {history.map((v) => (
            <Text key={v.version} variant="caption" color="textMuted">
              v{v.version} · {new Date(v.updated_at).toLocaleDateString()}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.feedback}>
        <Divider />
        {draft != null ? (
          <View style={styles.editor} testID="wiki-editor">
            <Text variant="label" color="textSecondary">
              Rewrite this in your own words
            </Text>
            <TextField
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder="What’s actually true for you?"
              testID="wiki-edit-input"
            />
            <View style={styles.editorActions}>
              <Button title="Cancel" variant="ghost" size="sm" onPress={() => setDraft(null)} />
              <Button
                title="Save"
                size="sm"
                onPress={() => void saveCorrection()}
                disabled={!draft.trim()}
                testID="wiki-edit-save"
              />
            </View>
          </View>
        ) : page.dismissed_at != null ? (
          <Card variant="sunken" style={styles.droppedCard} testID="wiki-dropped-banner">
            <Text variant="bodyStrong">You dropped this insight</Text>
            <Text variant="caption" color="textSecondary" style={styles.droppedHint}>
              It’s no longer shaping your reflections or conversations.
            </Text>
            <Button
              title="Restore it"
              variant="secondary"
              size="sm"
              onPress={() => void restore()}
              testID="wiki-restore"
            />
          </Card>
        ) : (
          <>
            {page.corrected_at != null && (
              <Text variant="caption" color="textMuted" testID="wiki-corrected-badge">
                ✎ In your own words
              </Text>
            )}
            <Button
              title={regenerating ? 'Regenerating…' : 'Regenerate in a consistent voice'}
              variant="secondary"
              loading={regenerating}
              onPress={() => void onRegenerate()}
              testID="wiki-regenerate"
            />
            <Button
              title="Rewrite this myself"
              variant="ghost"
              onPress={() => setDraft(page.content)}
              testID="wiki-rewrite"
            />
            <Button
              title="This isn’t right about me"
              variant="ghost"
              onPress={confirmDismiss}
              testID="wiki-dismiss"
            />
          </>
        )}
      </View>
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    meta: { marginTop: t.spacing.xs, marginBottom: t.spacing.md },
    richness: { marginBottom: t.spacing.xl },
    history: { marginTop: t.spacing['2xl'], paddingTop: t.spacing.md, gap: t.spacing.xs },
    historyTitle: { marginBottom: t.spacing.xs },
    feedback: { marginTop: t.spacing['2xl'], paddingTop: t.spacing.md, gap: t.spacing.md },
    droppedCard: { gap: t.spacing.sm, alignItems: 'flex-start' },
    droppedHint: {},
    editor: { gap: t.spacing.md },
    editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: t.spacing.sm },
  })
