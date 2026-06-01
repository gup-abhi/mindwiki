import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

export default function Home() {
  const router = useRouter()
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>MindWiki</Text>
      <Text style={styles.subtitle}>How are you today?</Text>
      <Pressable
        accessibilityRole="button"
        style={styles.cta}
        onPress={() => router.push('/entry')}
      >
        <Text style={styles.ctaText}>New entry</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 16, color: '#666', marginTop: 8, marginBottom: 32 },
  cta: { backgroundColor: '#1a1a2e', paddingVertical: 16, paddingHorizontal: 48, borderRadius: 14 },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
