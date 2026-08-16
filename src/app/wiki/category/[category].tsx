import { useMemo } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { FlatList, StyleSheet, View } from 'react-native'

import { Divider, EmptyState, IconButton, ListRow, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { categoryKey, categoryLabel } from '@/services/wiki/categories'
import { useWikiPages } from '@/hooks/useWiki'

export default function WikiCategoryScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { category } = useLocalSearchParams<{ category?: string }>()
  const key = category ?? 'other'
  const { pages, loading } = useWikiPages()

  const inCategory = useMemo(
    () => pages.filter((p) => categoryKey(p.category) === key),
    [pages, key]
  )

  return (
    <Screen padded={false}>
      <FlatList
        data={inCategory}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Divider}
        ListHeaderComponent={
          <View style={styles.header}>
            <IconButton
              name="chevron-back"
              color="accent"
              accessibilityLabel="Back to your wiki"
              onPress={() => router.back()}
              testID="category-back"
            />
            <View style={styles.headerContent}>
              <Text accessibilityRole="header" variant="title">
                {categoryLabel(key)}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Text variant="body" color="textMuted" style={styles.state}>Loading pages…</Text>
          ) : (
            <EmptyState icon="book-outline" title="Nothing here yet" message="No pages in this category." />
          )
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.title}
            subtitle={`${item.entry_count} ${item.entry_count === 1 ? 'entry' : 'entries'}`}
            onPress={() => router.push(`/wiki/${item.id}`)}
          />
        )}
      />
    </Screen>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    listContent: { paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.md, paddingBottom: t.spacing['2xl'] },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      paddingTop: t.spacing.lg,
      marginBottom: t.spacing.md,
    },
    headerContent: { flex: 1 },
    state: { paddingVertical: t.spacing['2xl'], textAlign: 'center' },
  })
