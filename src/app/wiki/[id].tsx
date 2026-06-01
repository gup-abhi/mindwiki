import { useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { useWikiPage } from '@/hooks/useWiki'

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>
      <Text style={styles.title}>{page.title}</Text>
      <Text style={styles.meta}>
        {page.category ?? 'page'} · v{page.version} · {page.entry_count}{' '}
        {page.entry_count === 1 ? 'entry' : 'entries'}
      </Text>
      <Text style={styles.content}>{page.content}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  muted: { color: '#999', fontSize: 15 },
  body: { padding: 24, paddingTop: 56 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a2e' },
  meta: { fontSize: 13, color: '#999', marginTop: 6, marginBottom: 20 },
  content: { fontSize: 16, color: '#222', lineHeight: 24 },
})
