import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { useWikiQuery } from '@/hooks/useWikiQuery'

export default function QueryScreen() {
  const router = useRouter()
  const { q } = useLocalSearchParams<{ q?: string }>()
  const initial = typeof q === 'string' ? q : undefined
  const { suggestions, recentPages, answer, related, asking, ask } = useWikiQuery(initial)
  const [text, setText] = useState(initial ?? '')

  const submit = (q: string) => {
    setText(q)
    ask(q)
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Ask your wiki</Text>
      <Text style={styles.subtitle}>Answers come only from your own journal.</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Ask a question…"
          placeholderTextColor="#999"
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit(text)}
          returnKeyType="search"
        />
        <Pressable accessibilityRole="button" style={styles.askBtn} onPress={() => submit(text)}>
          <Text style={styles.askBtnText}>Ask</Text>
        </Pressable>
      </View>

      {asking && <ActivityIndicator style={styles.spinner} color="#7a7ad0" />}

      {answer && !asking && (
        <View style={styles.answerCard}>
          <Text style={styles.answerText}>{answer.answer}</Text>
          {answer.sources.length > 0 && (
            <>
              <Text style={styles.evidence}>
                Drawn from {answer.sources.length}{' '}
                {answer.sources.length === 1 ? 'page' : 'pages'} · {answer.evidenceCount}{' '}
                {answer.evidenceCount === 1 ? 'entry' : 'entries'}
              </Text>
              <View style={styles.chips}>
                {answer.sources.map((p) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    style={styles.chip}
                    onPress={() => router.push(`/wiki/${p.id}`)}
                  >
                    <Text style={styles.chipText}>{p.title}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable accessibilityRole="button" onPress={() => router.push('/graph')}>
                <Text style={styles.explore}>Explore in graph →</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {answer && !asking && related.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Entries behind this</Text>
          {related.map((e) => (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              style={styles.entryRow}
              onPress={() => router.push(`/entries/${e.id}`)}
            >
              <Text style={styles.entryDate}>
                {new Date(e.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
              <Text style={styles.entrySnippet} numberOfLines={1}>
                {e.situation}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {!answer && !asking && suggestions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Try asking</Text>
          {suggestions.map((q) => (
            <Pressable key={q} accessibilityRole="button" style={styles.suggestion} onPress={() => submit(q)}>
              <Text style={styles.suggestionText}>{q}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!answer && !asking && recentPages.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recent pages</Text>
          <View style={styles.chips}>
            {recentPages.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                style={styles.chip}
                onPress={() => router.push(`/wiki/${p.id}`)}
              >
                <Text style={styles.chipText}>{p.title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <Text style={styles.back} onPress={() => router.replace('/')}>
        ← Home
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 24, paddingTop: 56 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 14, color: '#999', marginTop: 4, marginBottom: 18 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f7f7fb',
    borderRadius: 12,
    marginBottom: 8,
  },
  entryDate: { fontSize: 12, color: '#7a7ad0', fontWeight: '700', width: 48 },
  entrySnippet: { flex: 1, fontSize: 15, color: '#1a1a2e' },
  searchRow: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e2ee',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a2e',
  },
  askBtn: { backgroundColor: '#1a1a2e', borderRadius: 12, paddingHorizontal: 20, justifyContent: 'center' },
  askBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  spinner: { marginTop: 28 },
  answerCard: { marginTop: 20, backgroundColor: '#f7f7fb', borderRadius: 14, padding: 18 },
  answerText: { fontSize: 16, color: '#1a1a2e', lineHeight: 24 },
  evidence: { fontSize: 12, color: '#999', marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { backgroundColor: '#e7e7f4', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: '#1a1a2e', fontSize: 14, fontWeight: '600' },
  explore: { color: '#7a7ad0', fontSize: 15, fontWeight: '600', marginTop: 16 },
  section: { marginTop: 28 },
  sectionLabel: { fontSize: 13, color: '#7a7ad0', fontWeight: '700', marginBottom: 10 },
  suggestion: { backgroundColor: '#f7f7fb', borderRadius: 12, padding: 14, marginBottom: 10 },
  suggestionText: { fontSize: 15, color: '#333' },
  back: { fontSize: 16, color: '#7a7ad0', fontWeight: '600', marginTop: 32, textAlign: 'center' },
})
