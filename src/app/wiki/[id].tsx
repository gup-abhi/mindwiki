import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Alert, Pressable, StyleSheet, View } from 'react-native'

import { Button, Card, Divider, IconButton, ProgressBar, Screen, Text, TextField } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { Markdown } from '@/components/wiki/Markdown'
import { WikiConnections } from '@/components/wiki/WikiConnections'
import { PageTrendView, TrendLegend } from '@/components/wiki/PageTrendView'
import { useWikiPage, usePageTrend } from '@/hooks/useWiki'
import { useReframes } from '@/hooks/useReframes'
import { getContributionSummary, type ContributionSummary } from '@/services/storage/wiki-contributions'

const RICHNESS_TARGET = 10 // entries at which the richness bar is full

export default function WikiPageScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { id, firstRun } = useLocalSearchParams<{ id?: string; firstRun?: string }>()
  const { page, loading, dismiss, restore, correct, regenerate, regenerating } = useWikiPage(id)
  const trend = usePageTrend(page)
  const [draft, setDraft] = useState<string | null>(null) // non-null while editing
  const [showEarlier, setShowEarlier] = useState(false) // expand older reframes
  const [contributionSummary, setContributionSummary] = useState<ContributionSummary | null>(null)
  // Beliefs can be challenged with a CBT reframe; only beliefs surface that flow.
  const isBelief = page?.category === 'belief'
  const { reframes } = useReframes(isBelief ? (page?.title ?? null) : null)

  useEffect(() => {
    let active = true
    if (!page) {
      setContributionSummary(null)
      return
    }
    void getContributionSummary(page.id).then((res) => {
      if (active) setContributionSummary(res.success ? res.data : null)
    })
    return () => {
      active = false
    }
  }, [page?.id, page?.updated_at])

  const onRegenerate = async () => {
    const error = await regenerate()
    if (error) {
      Alert.alert(
        'Couldn’t regenerate',
        'The on-device AI didn’t return a clean rewrite this time. Tap Regenerate to try again.'
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

  const richness = Math.min(page.entry_count, RICHNESS_TARGET) / RICHNESS_TARGET

  return (
    <Screen scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          color="accent"
          accessibilityLabel="Back to your wiki"
          onPress={() => router.back()}
          testID="wiki-page-back"
        />
        <View style={styles.headerContent}>
          <Text accessibilityRole="header" variant="heading">{page.title}</Text>
          <Text variant="caption" color="textMuted" style={styles.meta}>
            {page.category ?? 'page'} · v{page.version} · {page.entry_count}{' '}
            {page.entry_count === 1 ? 'entry' : 'entries'}
          </Text>
        </View>
      </View>
      {contributionSummary && contributionSummary.count > 0 && (
        <Text variant="caption" color="textMuted" style={styles.provenance} testID="wiki-provenance">
          Shaped by {contributionSummary.count}{' '}
          {contributionSummary.count === 1 ? 'reflection' : 'reflections'} · last updated{' '}
          {new Date(page.updated_at).toLocaleDateString()}
        </Text>
      )}

      <View style={styles.richness}>
        <ProgressBar progress={richness} />
      </View>

      {firstRun === '1' && (
        <Card variant="sunken" style={styles.firstRunCard} testID="wiki-first-run-card">
          <Text variant="subtitle">This is your wiki</Text>
          <Text variant="body" color="textSecondary">
            It grows every time you write. Each entry quietly shapes your insight pages — so you never
            have to re-read old notes to find the thread.
          </Text>
          <Button
            title="Take me home"
            variant="primary"
            fullWidth
            onPress={() => router.replace('/')}
            testID="wiki-first-run-home"
          />
        </Card>
      )}
      <Markdown content={page.content} />

      {page.dismissed_at == null && <WikiConnections title={page.title} category={page.category} />}

      {trend?.message && page.dismissed_at == null && (
        <View style={styles.trendSection}>
          <Divider />
          <Text variant="label" color="textSecondary" style={styles.trendTitle}>
            How this has changed
          </Text>
          <TrendLegend />
          <PageTrendView trend={trend} />
        </View>
      )}

      {isBelief && page.dismissed_at == null && (
        <View style={styles.reframeSection}>
          <Button
            title="Challenge this belief"
            variant="secondary"
            fullWidth
            onPress={() => router.push({ pathname: '/reframe', params: { pageId: page.id } })}
            testID="wiki-challenge-belief"
          />
          {reframes.length > 0 && (
            <View style={styles.reframeList}>
              <Text variant="label" color="textSecondary">
                Your reframes
              </Text>
              {/* Latest stays in view; older ones collapse behind a toggle so the
                  page stays readable as reframes accumulate (newest-first). */}
              {(showEarlier ? reframes : reframes.slice(0, 1)).map((r) => (
                <Card key={r.id} variant="sunken" style={styles.reframeCard} testID="wiki-reframe">
                  <Text variant="body">{r.balanced_thought}</Text>
                  <Text variant="caption" color="textMuted" style={styles.reframeDate}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </Text>
                </Card>
              ))}
              {reframes.length > 1 && (
                <Text
                  variant="label"
                  color="accent"
                  onPress={() => setShowEarlier((v) => !v)}
                  style={styles.reframeToggle}
                  testID="wiki-reframes-toggle"
                >
                  {showEarlier
                    ? 'Hide earlier reframes'
                    : `${reframes.length - 1} earlier ${reframes.length - 1 === 1 ? 'reframe' : 'reframes'}`}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {(page.version_history ?? []).length > 0 ? (
        <View style={styles.history}>
          <Divider />
          <Text variant="label" color="textSecondary" style={styles.historyTitle}>
            Previous versions
          </Text>
          <Text variant="caption" color="textMuted" style={styles.historyCount}>
            {page.version} versions · first{' '}
            {new Date(page.version_history[0]?.updated_at ?? page.created_at).toLocaleDateString()}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/wiki/${page.id}/evolution`)}
            style={styles.evolutionLink}
            testID="wiki-see-evolution"
          >
            <Text variant="label" color="accent">
              See evolution →
            </Text>
          </Pressable>
        </View>
      ) : (page.version_history ?? []).length === 0 && page.version >= 2 ? (
        <View style={styles.history}>
          <Divider />
          <Text variant="label" color="textSecondary" style={styles.historyTitle}>
            Previous versions
          </Text>
          <Text variant="caption" color="textMuted">
            v{page.version} current
          </Text>
        </View>
      ) : null}

      <View style={styles.feedback}>
        <Divider />
        {draft != null ? (
          <View style={styles.editor} testID="wiki-editor">
            <Text variant="label" color="textSecondary">
              Rewrite this in your own words
            </Text>
            <TextField
              sensitive
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
            {/* Dev-only: kept out of the shipping UI but handy for testing prompt
                or model changes against existing pages. */}
            {__DEV__ && (
              <Button
                title={regenerating ? 'Regenerating…' : 'Regenerate (dev)'}
                variant="secondary"
                loading={regenerating}
                onPress={() => void onRegenerate()}
                testID="wiki-regenerate"
              />
            )}
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
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: t.spacing.sm,
      paddingTop: t.spacing.lg,
      marginBottom: t.spacing.md,
    },
    headerContent: { flex: 1 },
    meta: { marginTop: t.spacing.xs },
    provenance: { marginTop: t.spacing.xs, marginBottom: t.spacing.md },
    firstRunCard: { marginBottom: t.spacing.xl },
    richness: { marginBottom: t.spacing.xl },
    trendSection: { marginTop: t.spacing['2xl'], gap: t.spacing.md },
    trendTitle: {},
    reframeSection: { marginTop: t.spacing['2xl'], gap: t.spacing.lg },
    reframeList: { gap: t.spacing.sm },
    reframeCard: { gap: t.spacing.xs, alignItems: 'flex-start' },
    reframeDate: {},
    reframeToggle: { marginTop: t.spacing.xs },
    history: { marginTop: t.spacing['2xl'], paddingTop: t.spacing.md, gap: t.spacing.xs },
    historyTitle: { marginBottom: t.spacing.xs },
    historyCount: { marginBottom: t.spacing.sm },
    evolutionLink: { paddingVertical: t.spacing.sm },
    feedback: { marginTop: t.spacing['2xl'], paddingTop: t.spacing.md, gap: t.spacing.md },
    droppedCard: { gap: t.spacing.sm, alignItems: 'flex-start' },
    droppedHint: {},
    editor: { gap: t.spacing.md },
    editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: t.spacing.sm },
  })
