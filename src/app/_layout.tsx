import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import {
  useFonts,
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from '@expo-google-fonts/lora'
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from '@expo-google-fonts/nunito'

import { initStorage } from '@/services/storage/bootstrap'
import { configureNotifications } from '@/services/notifications/scheduler'
import { hydrateAuth } from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'
import { useLockStore } from '@/store/lock.store'
import { useSync } from '@/hooks/useSync'
import { useAppLock } from '@/hooks/useAppLock'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { LockScreen } from '@/components/auth/LockScreen'
import { CoverScreen } from '@/components/CoverScreen'
import { OnboardingCarousel } from '@/components/onboarding/OnboardingCarousel'
import { useFirstRunRedirect } from '@/hooks/useFirstRunRedirect'
import { hasSeenOnboarding, markOnboardingSeen } from '@/services/onboarding/seen'
import { ThemeProvider, type Theme, useTheme, useThemedStyles } from '@/theme'

// Hold the native splash until our custom fonts are ready (best-effort).
void SplashScreen.preventAutoHideAsync()

type StorageStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * App subtree mounted only once authenticated AND the encrypted DB is open, so
 * DB-backed work (screens, background sync) never runs before storage exists.
 */
function AppRoot() {
  useSync()
  // One-time first-run redirect: after the carousel, route the user through a
  // guided path so they produce entries and see their first wiki page.
  useFirstRunRedirect()
  // Overlay (not swap) the lock so navigation state survives lock/unlock.
  const locked = useAppLock()
  // Only after the cold-start lock decision is made, so the cover doesn't mount
  // (and burn its once-per-launch flash) during the brief pre-lock window.
  const lockResolved = useLockStore((s) => s.resolved)
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {/* After a genuine unlock, flash the earned affirmation before Home. */}
      {lockResolved && !locked && <CoverScreen />}
      {locked && <LockScreen />}
    </>
  )
}

/** Auth + encrypted-DB gate. Rendered inside the theme + safe-area providers. */
function AppGate() {
  const authStatus = useAuthStore((s) => s.status)
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [storage, setStorage] = useState<StorageStatus>('idle')
  const [message, setMessage] = useState('')
  // null = not yet resolved; gates the one-time welcome tour after the DB opens.
  const [onboarded, setOnboarded] = useState<boolean | null>(null)

  // Launch: configure notifications + resolve the session. No DB access yet.
  useEffect(() => {
    configureNotifications()
    void hydrateAuth()
  }, [])

  // On logout the session ends and logout() deletes the DB + master key; reset
  // storage to 'idle' so the next sign-in re-runs initStorage and opens a fresh
  // DB keyed to the new account (otherwise it stays 'ready' on the stale handle).
  useEffect(() => {
    if (authStatus === 'unauthenticated') setStorage('idle')
  }, [authStatus])

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

  // Resolve the one-time tour flag once the DB is open (so it shows after the
  // recovery-phrase step on first register, never before the app is reachable).
  useEffect(() => {
    if (storage !== 'ready') return
    void hasSeenOnboarding().then(setOnboarded)
  }, [storage])

  if (authStatus === 'loading') {
    return (
      <View testID="storage-loading" style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
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
  if (storage !== 'ready' || onboarded === null) {
    return (
      <View testID="storage-loading" style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    )
  }

  // First run on this device: show the welcome tour once, then enter the app.
  if (!onboarded) {
    return (
      <OnboardingCarousel
        onDone={() => {
          void markOnboardingSeen()
          setOnboarded(true)
        }}
      />
    )
  }

  return <AppRoot />
}

export default function RootLayout() {
  // Loads in parallel with hydrateAuth, so fonts don't add serial startup delay.
  const [fontsLoaded] = useFonts({
    Lora_400Regular,
    Lora_500Medium,
    Lora_600SemiBold,
    Lora_700Bold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
  })

  // Hide the splash once fonts are ready; until then keep it up (return null).
  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppGate />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.bg, padding: t.spacing['2xl'] },
    errTitle: { fontSize: 20, fontWeight: '700', color: t.colors.danger },
    errMsg: { fontSize: 14, color: t.colors.textSecondary, marginTop: t.spacing.sm, textAlign: 'center' },
  })
