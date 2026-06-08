import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { Divider, ProgressBar, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { Markdown } from '@/components/wiki/Markdown'
import { useWikiPage } from '@/hooks/useWiki'

const RICHNESS_TARGET = 10 // entries at which the richness bar is full

export default function WikiPageScreen() {
  const styles = useThemedStyles(makeStyles)
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { page, loading } = useWikiPage(id)

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
  })
