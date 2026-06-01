import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { initStorage } from '@/services/storage/bootstrap'

type Status = 'loading' | 'ready' | 'error'

export default function RootLayout() {
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    initStorage().then((result) => {
      if (!active) return
      if (result.success) {
        setStatus('ready')
      } else {
        setMessage(result.error.message)
        setStatus('error')
      }
    })
    return () => {
      active = false
    }
  }, [])

  if (status === 'loading') {
    return (
      <View testID="storage-loading" style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    )
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errTitle}>Storage error</Text>
        <Text style={styles.errMsg}>{message}</Text>
      </View>
    )
  }

  return <Stack screenOptions={{ headerShown: false }} />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 32 },
  errTitle: { fontSize: 20, fontWeight: '700', color: '#d12f2f' },
  errMsg: { fontSize: 14, color: '#666', marginTop: 8, textAlign: 'center' },
})
