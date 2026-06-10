import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'

import { Button, Text } from '@/components/ui'
import { authenticate } from '@/services/auth/biometric'
import { useLockStore } from '@/store/lock.store'
import { type Theme, useTheme, useThemedStyles } from '@/theme'

/**
 * Full-bleed lock overlay shown over the app while locked. Auto-prompts for
 * biometric / device-credential auth on mount; unlocks the store on success.
 */
export function LockScreen() {
  const styles = useThemedStyles(makeStyles)
  const theme = useTheme()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const tryUnlock = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    const ok = await authenticate('Unlock MindWiki')
    setBusy(false)
    if (ok) useLockStore.getState().unlock()
    else setFailed(true)
  }, [])

  useEffect(() => {
    void tryUnlock()
  }, [tryUnlock])

  return (
    <View style={styles.container} testID="lock-screen">
      <StatusBar style={theme.statusBar} />
      <Ionicons name="lock-closed" size={44} color={theme.colors.accent} />
      <Text variant="title" style={styles.title}>
        MindWiki is locked
      </Text>
      <Text variant="body" color="textSecondary" style={styles.subtitle}>
        Unlock with your biometrics or device PIN to continue.
      </Text>
      {failed && (
        <Text variant="caption" color="danger" style={styles.error}>
          Authentication failed. Try again.
        </Text>
      )}
      <View style={styles.action}>
        <Button title="Unlock" loading={busy} onPress={() => tryUnlock()} testID="lock-unlock" />
      </View>
    </View>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.bg,
      padding: t.spacing['2xl'],
    },
    title: { marginTop: t.spacing.lg },
    subtitle: { marginTop: t.spacing.sm, textAlign: 'center' },
    error: { marginTop: t.spacing.md },
    action: { marginTop: t.spacing.xl },
  })
