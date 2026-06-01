import { useLocalSearchParams, useRouter } from 'expo-router'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { CRISIS_RESOURCES } from '@/services/crisis/resources'

// Supportive, non-diagnostic copy that scales with severity. The app offers
// support resources only — it does not diagnose or treat.
const COPY: Record<number, { title: string; body: string }> = {
  1: {
    title: 'Thanks for writing this down',
    body: 'It sounds like things feel heavy right now. If it would help, support is always here.',
  },
  2: {
    title: "You don't have to go through this alone",
    body: 'What you’re feeling matters. Talking to someone can help — these services are free and confidential.',
  },
  3: {
    title: 'Please reach out — you matter',
    body: 'If you’re thinking about harming yourself, you’re not alone and help is available right now.',
  },
}

export default function CrisisScreen() {
  const router = useRouter()
  const { tier } = useLocalSearchParams<{ tier?: string }>()
  const t = Number(tier) || 1
  const copy = COPY[t] ?? COPY[1]

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.bodyText}>{copy.body}</Text>

      <Pressable style={styles.call} onPress={() => Linking.openURL('tel:988')}>
        <Text style={styles.callText}>Call or text 988</Text>
      </Pressable>

      {CRISIS_RESOURCES.map((r) => (
        <View key={r.name} style={styles.resource}>
          <Text style={styles.resourceName}>{r.name}</Text>
          <Text style={styles.resourceContact}>{r.contact}</Text>
          <Text style={styles.resourceDesc}>{r.description}</Text>
        </View>
      ))}

      <Pressable style={styles.continue} onPress={() => router.replace('/')}>
        <Text style={styles.continueText}>Continue</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 24, paddingTop: 48 },
  title: { fontSize: 26, fontWeight: '700', color: '#1a1a2e' },
  bodyText: { fontSize: 16, color: '#444', marginTop: 12, lineHeight: 24 },
  call: {
    backgroundColor: '#d12f2f',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  callText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  resource: {
    backgroundColor: '#f7f7fb',
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
  },
  resourceName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  resourceContact: { fontSize: 15, color: '#1a1a2e', marginTop: 4 },
  resourceDesc: { fontSize: 13, color: '#666', marginTop: 4 },
  continue: { paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  continueText: { color: '#666', fontSize: 16, fontWeight: '600' },
})
