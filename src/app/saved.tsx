import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export default function SavedScreen() {
  const router = useRouter()
  return (
    <View style={styles.container}>
      <Text style={styles.check}>✓</Text>
      <Text style={styles.title}>Entry saved</Text>
      <Text style={styles.subtitle}>
        Your reflection is encrypted on your device. Each entry grows your wiki.
      </Text>
      <Pressable accessibilityRole="button" style={styles.cta} onPress={() => router.replace('/')}>
        <Text style={styles.ctaText}>Done</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 32,
  },
  check: { fontSize: 56, color: '#1b9e4b', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', marginTop: 12, lineHeight: 22 },
  cta: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    marginTop: 32,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '600' },
})
