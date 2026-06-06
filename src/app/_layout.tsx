import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { initStorage } from '@/services/storage/bootstrap'
import { configureNotifications } from '@/services/notifications/scheduler'
import { hydrateAuth } from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'
import { useSync } from '@/hooks/useSync'
import { AuthScreen } from '@/components/auth/AuthScreen'

type StorageStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * App subtree mounted only once authenticated AND the encrypted DB is open, so
 * DB-backed work (screens, background sync) never runs before storage exists.
 */
function AppRoot() {
  useSync()
  return <Stack screenOptions={{ headerShown: false }} />
}

export default function RootLayout() {
  const authStatus = useAuthStore((s) => s.status)
  const [storage, setStorage] = useState<StorageStatus>('idle')
  const [message, setMessage] = useState('')

  // Launch: configure notifications + resolve the session. No DB access yet.
  useEffect(() => {
    configureNotifications()
    void hydrateAuth()
  }, [])

  // Open the encrypted DB only after auth — so it's keyed with the correct
  // master key (a fresh DB on a new-device login, the existing DB for a
  // returning user). Opening before auth would create it with a throwaway
  // device key and orphan it on login (see ADR/CLAUDE.md privacy model).
  useEffect(() => {
    if (authStatus !== 'authenticated' || storage !== 'idle') return
    setStorage('loading')
    initStorage().then((result) => {
      if (result.success) {
        setStorage('ready')
      } else {
        setMessage(result.error.message)
        setStorage('error')
      }
    })
  }, [authStatus, storage])

  if (authStatus === 'loading') {
    return (
      <View testID="storage-loading" style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    )
  }

  if (authStatus === 'unauthenticated') {
    return <AuthScreen />
  }

  // Authenticated — gate on the encrypted DB opening.
  if (storage === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errTitle}>Storage error</Text>
        <Text style={styles.errMsg}>{message}</Text>
      </View>
    )
  }
  if (storage !== 'ready') {
    return (
      <View testID="storage-loading" style={styles.center}>
        <ActivityIndicator size="large" color="#1a1a2e" />
      </View>
    )
  }

  return <AppRoot />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 32 },
  errTitle: { fontSize: 20, fontWeight: '700', color: '#d12f2f' },
  errMsg: { fontSize: 14, color: '#666', marginTop: 8, textAlign: 'center' },
})
