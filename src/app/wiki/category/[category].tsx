import { useMemo } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet } from 'react-native'

import { Divider, EmptyState, ListRow, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { categoryKey, categoryLabel } from '@/services/wiki/categories'
import { useWikiPages } from '@/hooks/useWiki'

export default function WikiCategoryScreen() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { category } = useLocalSearchParams<{ category?: string }>()
  const key = category ?? 'other'
  const { pages } = useWikiPages()

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
          <>
            <Pressable onPress={() => router.back()} testID="category-back">
              <Text variant="label" color="accent">
                ‹ Your wiki
              </Text>
            </Pressable>
            <Text variant="title" style={styles.title}>
              {categoryLabel(key)}
            </Text>
          </>
        }
        ListEmptyComponent={
          <EmptyState icon="book-outline" title="Nothing here yet" message="No pages in this category." />
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
    title: { marginTop: t.spacing.sm, marginBottom: t.spacing.md },
  })
