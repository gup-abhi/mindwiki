import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import * as Notifications from 'expo-notifications'
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
import { areModelsReady } from '@/services/llm/model-manager'
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
import { useFirstRunRedirect, resetFirstRunRedirect } from '@/hooks/useFirstRunRedirect'
import {
  beginOnboardingModelDownload,
  isFirstRunTourDone,
  isOnboardingIncomplete,
  markFirstRunTourDone,
} from '@/services/onboarding/first-run'
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
  const router = useRouter()
  // One-time first-run redirect: after the carousel, route the user through a
  // guided path so they produce entries and see their first wiki page.
  useFirstRunRedirect()

  // Decoupled model-download kick (P3): the carousel's onDone kicks the download
  // on consent, but a user whose carousel was killed mid-way (tour-done unset),
  // or whose download stalled and was relaunched, also needs the kick on launch.
  // Onboarding-incomplete + models-missing → start it. Idempotent per session.
  useEffect(() => {
    void (async () => {
      if (!(await isOnboardingIncomplete())) return
      if (await areModelsReady()) return
      beginOnboardingModelDownload()
    })()
  }, [])

  // Deep-link a tap on the "first insight page ready" notification (and any other
  // notification carrying a wikiId) to its wiki page. Registered once per app root
  // mount, after navigation is in scope. Also handle a cold-launch tap.
  useEffect(() => {
    const routeToWiki = (wikiId: unknown) => {
      if (typeof wikiId !== 'string' || !wikiId) return
      // Defer past the initial render so the router is ready to push.
      requestAnimationFrame(() => router.push(`/wiki/${wikiId}`))
    }
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) routeToWiki(resp.notification.request.content.data?.wikiId)
    })
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      routeToWiki(resp.notification.request.content.data?.wikiId)
    })
    return () => sub.remove()
  }, [router])

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
  // The welcome tour + guided first run are for brand-new accounts only. This is
  // true solely on the register→confirm-phrase path this session; login,
  // recovery, device pairing, and a returning session all leave it false.
  const isNewAccount = useAuthStore((s) => s.isNewAccount)
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [storage, setStorage] = useState<StorageStatus>('idle')
  const [message, setMessage] = useState('')
  // Session-local: set once the new user dismisses the tour, so it doesn't
  // re-show while isNewAccount stays true for the rest of this session.
  const [carouselDone, setCarouselDone] = useState(false)
  // Durable tour-done marker (read from per-account settings once the DB is open).
  // null while pending; true → a prior session dismissed the tour, so a kill during
  // this relaunch should NOT re-show it (resume the guided path instead).
  const [tourDone, setTourDone] = useState<boolean | null>(null)

  // Launch: configure notifications + resolve the session. No DB access yet.
  useEffect(() => {
    configureNotifications()
    void hydrateAuth()
  }, [])

  // On logout the session ends and logout() deletes the DB + master key; reset
  // storage to 'idle' so the next sign-in re-runs initStorage and opens a fresh
  // DB keyed to the new account (otherwise it stays 'ready' on the stale handle).
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      setStorage('idle')
      setTourDone(null)
      // Clear the session-global first-run guard so a different account signing
      // in on this same app session can still be routed through its first run.
      resetFirstRunRedirect()
    }
  }, [authStatus])

  // Open the encrypted DB only after auth — so it's keyed with the correct
  // master key (a fresh DB on a new-device login, the existing DB for a
  // returning user). Opening before auth would create it with a throwaway
  // device key and orphan it on login (see ADR/CLAUDE.md privacy model).
  // Resolves the durable tour-done marker atomically with storage readiness so
  // the carousel gate never sees a null tourDone on the first render (P3).
  useEffect(() => {
    if (authStatus !== 'authenticated' || storage !== 'idle') return
    setStorage('loading')
    initStorage().then(async (result) => {
      if (result.success) {
        const done = await isFirstRunTourDone().catch(() => false)
        setTourDone(done)
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
  if (storage !== 'ready') {
    return (
      <View testID="storage-loading" style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    )
  }

  // Brand-new account (register→confirm this session): show the welcome tour
  // once, then enter the app. A kill DURING the tour (tourDone=false) re-shows it
  // on relaunch; a kill AFTER it resumes the guided path directly (P3).
  // tourDone===null while we check the durable marker (not yet resolved from the
  // DB) — during that render beat we fall through to AppRoot, which is fine since
  // useFirstRunRedirect won't route until storage is consistently loaded too.
  if (isNewAccount && !carouselDone && tourDone === false) {
    return (
      <OnboardingCarousel
        onDone={async () => {
          // Consent point: start the ~2.8 GB model download in the background so
          // the models arrive while the user completes the guided path.
          // Fire-and-forget; the Home ModelDownloadCard remains as retry.
          await markFirstRunTourDone()
          beginOnboardingModelDownload()
          setCarouselDone(true)
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
