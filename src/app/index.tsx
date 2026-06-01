import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

import { useEntries } from '@/hooks/useEntries'
import { useWikiStore } from '@/store/wiki.store'

export default function Home() {
  const router = useRouter()
  const { entries, count } = useEntries()
  const synthesizing = useWikiStore((s) => s.pending > 0)

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>MindWiki</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.cta}
              onPress={() => router.push('/entry')}
            >
              <Text style={styles.ctaText}>New entry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.wikiLink}
              onPress={() => router.push('/wiki')}
            >
              <Text style={styles.wikiLinkText}>View wiki →</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.wikiLink}
              onPress={() => router.push('/graph')}
            >
              <Text style={styles.wikiLinkText}>View graph →</Text>
            </Pressable>
            {synthesizing && <Text style={styles.synth}>Synthesizing your wiki…</Text>}
            <Text style={styles.count}>
              {count} {count === 1 ? 'entry' : 'entries'} so far
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.situation} numberOfLines={1}>
              {item.situation}
            </Text>
            <Text style={styles.tags}>
              {item.emotion
                ? `${item.emotion} · ${item.distortion} · mood ${item.mood_score}`
                : 'tagging…'}
            </Text>
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  listContent: { paddingBottom: 32 },
  header: { alignItems: 'center', paddingTop: 64, paddingBottom: 24 },
  title: { fontSize: 32, fontWeight: '700', color: '#1a1a2e' },
  cta: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    marginTop: 20,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  wikiLink: { marginTop: 16 },
  wikiLinkText: { fontSize: 15, color: '#1a1a2e', fontWeight: '600' },
  synth: { marginTop: 10, fontSize: 13, color: '#7a7ad0' },
  count: { marginTop: 16, fontSize: 14, color: '#999' },
  row: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#eee' },
  situation: { fontSize: 16, color: '#1a1a2e' },
  tags: { fontSize: 13, color: '#666', marginTop: 4 },
})
