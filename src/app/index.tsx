import { StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

export default function Home() {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>MindWiki</Text>
      <Text style={styles.subtitle}>Phase 0 — Foundation</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: '700', color: '#1a1a2e' },
  subtitle: { fontSize: 16, color: '#666', marginTop: 8 },
})
