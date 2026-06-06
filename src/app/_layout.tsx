import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { initStorage } from '@/services/storage/bootstrap'
import { configureNotifications } from '@/services/notifications/scheduler'
import { hydrateAuth } from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'
import { useSync } from '@/hooks/useSync'
import { AuthScreen } from '@/components/auth/AuthScreen'

type Status = 'loading' | 'ready' | 'error'

export default function RootLayout() {
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')
  const authStatus = useAuthStore((s) => s.status)

  // Opportunistic background sync once authenticated (no-op until then).
  useSync()

  useEffect(() => {
    let active = true
    configureNotifications()
    initStorage().then((result) => {
      if (!active) return
      if (result.success) {
        setStatus('ready')
        // Resolve the session from stored tokens once storage is up.
        void hydrateAuth()
      } else {
        setMessage(result.error.message)
        setStatus('error')
      }
    })
    return () => {
      active = false
    }
  }, [])

  if (status === 'loading' || (status === 'ready' && authStatus === 'loading')) {
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

  if (authStatus === 'unauthenticated') {
    return <AuthScreen />
  }

  return <Stack screenOptions={{ headerShown: false }} />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 32 },
  errTitle: { fontSize: 20, fontWeight: '700', color: '#d12f2f' },
  errMsg: { fontSize: 14, color: '#666', marginTop: 8, textAlign: 'center' },
})
