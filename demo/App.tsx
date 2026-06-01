import { useState } from 'react'
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

import SystemCheck from '@/screens/SystemCheck'
import EntrySmoke from '@/screens/EntrySmoke'

type Screen = 'system' | 'entry'

export default function App() {
  const [screen, setScreen] = useState<Screen>('system')

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.body}>{screen === 'system' ? <SystemCheck /> : <EntrySmoke />}</View>

      <View style={styles.tabBar}>
        <Tab label="System Check" active={screen === 'system'} onPress={() => setScreen('system')} />
        <Tab label="Entry Smoke" active={screen === 'entry'} onPress={() => setScreen('entry')} />
      </View>
    </SafeAreaView>
  )
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  tab: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  tabText: { fontSize: 15, color: '#999' },
  tabTextActive: { color: '#1a1a2e', fontWeight: '700' },
})
