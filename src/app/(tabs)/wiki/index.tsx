import { useRouter } from 'expo-router'
import { FlatList, StyleSheet } from 'react-native'

import { Divider, EmptyState, ListRow, Screen, Text } from '@/components/ui'
import { type Theme, useThemedStyles } from '@/theme'
import { useWikiPages } from '@/hooks/useWiki'
import { useWikiStore } from '@/store/wiki.store'

export default function WikiBrowse() {
  const router = useRouter()
  const styles = useThemedStyles(makeStyles)
  const { pages, loading } = useWikiPages()
  const synthesizing = useWikiStore((s) => s.pending > 0)

  return (
    <Screen padded={false}>
      <FlatList
        data={pages}
        keyExtractor={(p) => p.id}
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
            title={item.title}
            subtitle={`${item.category ?? 'page'} · ${item.entry_count} ${
              item.entry_count === 1 ? 'entry' : 'entries'
            }`}
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
    title: { marginBottom: t.spacing.md },
    synth: { marginTop: -t.spacing.sm, marginBottom: t.spacing.md },
  })
