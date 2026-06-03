import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

import { useEntries } from '@/hooks/useEntries'
import { useWikiPages } from '@/hooks/useWiki'
import { useWikiStore } from '@/store/wiki.store'
import { computeStreak } from '@/services/notifications/streak'
import { streakStage } from '@/services/notifications/stage'
import { generateDigest } from '@/services/digest/generator'
import { suggestedQuestions } from '@/services/wiki/query'

export default function Home() {
  const router = useRouter()
  const { entries, count } = useEntries()
  const { pages } = useWikiPages()
  const synthesizing = useWikiStore((s) => s.pending > 0)
  const stage = useMemo(
    () => streakStage(computeStreak(entries.map((e) => e.created_at), Date.now()).current),
    [entries]
  )
  const digestReady = useMemo(() => generateDigest(entries, Date.now()) !== null, [entries])
  const surfacedQuestion = useMemo(() => suggestedQuestions(pages, 1)[0] ?? null, [pages])

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
            <Text style={styles.stage}>{stage.headline}</Text>
            {digestReady && (
              <Pressable
                accessibilityRole="button"
                style={styles.digestCard}
                onPress={() => router.push('/digest')}
              >
                <Text style={styles.digestTitle}>Your weekly digest is ready</Text>
                <Text style={styles.digestSub}>See your week at a glance →</Text>
              </Pressable>
            )}
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
            <Pressable
              accessibilityRole="button"
              style={styles.wikiLink}
              onPress={() => router.push('/query')}
            >
              <Text style={styles.wikiLinkText}>Ask your wiki →</Text>
            </Pressable>
            {surfacedQuestion && (
              <Pressable
                accessibilityRole="button"
                style={styles.surfaceCard}
                onPress={() => router.push({ pathname: '/query', params: { q: surfacedQuestion } })}
              >
                <Text style={styles.surfaceLabel}>Curious?</Text>
                <Text style={styles.surfaceText}>{surfacedQuestion}</Text>
              </Pressable>
            )}
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
  stage: { marginTop: 8, fontSize: 14, color: '#7a7ad0', fontWeight: '600', textAlign: 'center' },
  digestCard: {
    marginTop: 20,
    backgroundColor: '#7a7ad0',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  digestTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  digestSub: { color: '#eee', fontSize: 13, marginTop: 4 },
  surfaceCard: {
    marginTop: 16,
    backgroundColor: '#f2f2f7',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignSelf: 'stretch',
  },
  surfaceLabel: { fontSize: 12, color: '#7a7ad0', fontWeight: '700' },
  surfaceText: { fontSize: 15, color: '#1a1a2e', marginTop: 3 },
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
