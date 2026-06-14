import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { FlatList, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Divider, EmptyState, ListRow, Screen, Text } from '@/components/ui'
import { type Theme, useTheme, useThemedStyles } from '@/theme'
import { CATEGORY_ORDER, categoryKey, categoryLabel } from '@/services/wiki/categories'
import { useDismissedPages, useWikiPages } from '@/hooks/useWiki'
import { useWikiStore } from '@/store/wiki.store'

interface CategorySummary {
  key: string
  label: string
  count: number
}

export default function WikiBrowse() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const { pages, loading } = useWikiPages()
  const { pages: dismissed } = useDismissedPages()
  const synthesizing = useWikiStore((s) => s.pending > 0)

  // One row per category present, with its page count.
  const categories = useMemo<CategorySummary[]>(() => {
    const counts = new Map<string, number>()
    for (const p of pages) {
      const k = categoryKey(p.category)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({
      key: c,
      label: categoryLabel(c),
      count: counts.get(c) ?? 0,
    }))
  }, [pages])

  return (
    <Screen padded={false}>
      <FlatList
        data={categories}
        keyExtractor={(c) => c.key}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <>
            <Text variant="title" style={styles.title}>
              Your wiki
            </Text>
            {synthesizing && (
              <Text variant="caption" color="accent" style={styles.synth}>
                Synthesizing…
              </Text>
            )}
          </>
        }
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="book-outline"
              title="No pages yet"
              message="Write a few entries and they’ll be synthesized here."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.label}
            subtitle={`${item.count} ${item.count === 1 ? 'page' : 'pages'}`}
            onPress={() => router.push(`/wiki/category/${item.key}`)}
            right={<Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />}
          />
        )}
        ListFooterComponent={
          dismissed.length > 0 ? (
            <ListRow
              title="Dropped insights"
              subtitle={`${dismissed.length} ${dismissed.length === 1 ? 'page' : 'pages'} you set aside`}
              onPress={() => router.push('/wiki/dismissed')}
              right={<Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />}
            />
          ) : null
        }
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    listContent: { paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md, paddingBottom: t.spacing['2xl'] },
    title: { marginBottom: t.spacing.md },
    synth: { marginTop: -t.spacing.sm, marginBottom: t.spacing.md },
  })
