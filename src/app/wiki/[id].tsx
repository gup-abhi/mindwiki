import { useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { Markdown } from '@/components/wiki/Markdown'
import { useWikiPage } from '@/hooks/useWiki'

const RICHNESS_TARGET = 10 // entries at which the richness bar is full

export default function WikiPageScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { page, loading } = useWikiPage(id)

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    )
  }
  if (!page) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Page not found</Text>
      </View>
    )
  }

  const history = page.version_history ?? []
  const richness = Math.min(page.entry_count, RICHNESS_TARGET) / RICHNESS_TARGET

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>
      <Text style={styles.title}>{page.title}</Text>
      <Text style={styles.meta}>
        {page.category ?? 'page'} · v{page.version} · {page.entry_count}{' '}
        {page.entry_count === 1 ? 'entry' : 'entries'}
      </Text>

      <View style={styles.richnessTrack}>
        <View style={[styles.richnessFill, { width: `${richness * 100}%` }]} />
      </View>

      <Markdown content={page.content} />

      {history.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>
            {history.length} previous {history.length === 1 ? 'version' : 'versions'}
          </Text>
          {history.map((v) => (
            <Text key={v.version} style={styles.historyItem}>
              v{v.version} · {new Date(v.updated_at).toLocaleDateString()}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  muted: { color: '#999', fontSize: 15 },
  body: { padding: 24, paddingTop: 56 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a2e' },
  meta: { fontSize: 13, color: '#999', marginTop: 6, marginBottom: 12 },
  richnessTrack: { height: 6, backgroundColor: '#eee', borderRadius: 3, marginBottom: 20 },
  richnessFill: { height: 6, backgroundColor: '#7a7ad0', borderRadius: 3 },
  history: { marginTop: 28, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 16 },
  historyTitle: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8 },
  historyItem: { fontSize: 13, color: '#999', marginTop: 2 },
})
