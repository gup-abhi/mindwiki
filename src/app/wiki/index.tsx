import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { useWikiPages } from '@/hooks/useWiki'

export default function WikiBrowse() {
  const router = useRouter()
  const { pages, loading } = useWikiPages()

  return (
    <View style={styles.container}>
      <FlatList
        data={pages}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<Text style={styles.title}>Your wiki</Text>}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>
              No pages yet — write a few entries and they’ll be synthesized here.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => router.push(`/wiki/${item.id}`)}
          >
            <Text style={styles.pageTitle}>{item.title}</Text>
            <Text style={styles.meta}>
              {item.category ?? 'page'} · {item.entry_count}{' '}
              {item.entry_count === 1 ? 'entry' : 'entries'}
            </Text>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  listContent: { padding: 20, paddingTop: 56 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a2e', marginBottom: 16 },
  empty: { fontSize: 15, color: '#999', lineHeight: 22 },
  row: { paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  pageTitle: { fontSize: 18, fontWeight: '600', color: '#1a1a2e' },
  meta: { fontSize: 13, color: '#666', marginTop: 4 },
})
