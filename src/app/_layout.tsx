import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import * as Notifications from 'expo-notifications'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native'
import {
  useFonts,
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from '@expo-google-fonts/lora'
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from '@expo-google-fonts/nunito'

import { initStorage } from '@/services/storage/bootstrap'
import { closeDb } from '@/services/storage/db'
import { areModelsReady } from '@/services/llm/model-manager'
import { configureNotifications } from '@/services/notifications/scheduler'
import { cleanupNotifications } from '@/services/notifications/cleanup'
import { handleNotificationCandidate, handleNotificationDelivered, recordAndReconcile, resumeNotificationReconciliation } from '@/services/notifications/orchestrator'
import { createNotificationResponseHandler } from '@/services/notifications/response'
import { canReturnToAccountFromDeletion, deleteAccount, hydrateAuth, returnToAccountFromDeletion } from '@/services/auth/auth.service'
import { resetSessionStores } from '@/services/auth/session-reset'
import { useAuthStore } from '@/store/auth.store'
import { useLockStore } from '@/store/lock.store'
import { useSync } from '@/hooks/useSync'
import { useAppLock } from '@/hooks/useAppLock'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { Button } from '@/components/ui'
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
  useEffect(() => {
    resumeNotificationReconciliation()
    void recordAndReconcile('app_active', 'launch')
  }, [])

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

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      void handleNotificationDelivered(notification.request.identifier)
    })
    return () => sub.remove()
  }, [])

  // Notification payload contains only opaque candidateId + allowlisted kind.
  // Resolve route through encrypted DB after auth, then clear native response.
  useEffect(() => {
    // Deduplicate by request identifier (not a mount-lifetime boolean). Every
    // consumed response is cleared, including malformed/duplicate stimuli.
    const routeFromResponse = createNotificationResponseHandler({
      handleCandidate: handleNotificationCandidate,
      navigate: (route) => requestAnimationFrame(() => router.push(route as never)),
      clearResponse: () => Notifications.clearLastNotificationResponseAsync(),
    })
    void Notifications.getLastNotificationResponseAsync().then(routeFromResponse)
    const sub = Notifications.addNotificationResponseReceivedListener(routeFromResponse)
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
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const [deletionAction, setDeletionAction] = useState<'retry' | 'return' | null>(null)
  const [canReturnFromDeletion, setCanReturnFromDeletion] = useState(false)
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

  // The session ended. Two paths reach here: logout (which already wiped the DB +
  // key + stores) and session expiry (which keeps key + DB on disk, R5). Handle
  // both idempotently: close any open DB handle so none outlives the session
  // (case 13), reset in-memory stores so a new sign-in can't see residue
  // (case 12), and set storage 'idle' so the next sign-in re-runs initStorage on
  // a fresh handle keyed to that account.
  useEffect(() => {
    if (authStatus === 'deleting' || authStatus === 'unauthenticated') {
      void cleanupNotifications()
      closeDb()
      resetSessionStores()
      setStorage('idle')
      setTourDone(null)
      // Clear the session-global first-run guard so a different account signing
      // in on this same app session can still be routed through its first run.
      resetFirstRunRedirect()
    }
  }, [authStatus])

  // Only offer cancellation after the server confirms that remote deletion has
  // not started. Unknown/unreachable status keeps the privacy-safe locked state.
  useEffect(() => {
    if (authStatus !== 'deleting') {
      setCanReturnFromDeletion(false)
      return
    }
    let active = true
    void canReturnToAccountFromDeletion().then((result) => {
      if (active) setCanReturnFromDeletion(result.success && result.data)
    })
    return () => { active = false }
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

  if (authStatus === 'deleting') {
    return (
      <View style={styles.center} testID="account-deletion-gate">
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={styles.errTitle}>Deleting your account</Text>
        <Text style={styles.errMsg}>
          Your journal is locked while MindWiki removes the encrypted sync backup and account data.
        </Text>
        {deletionError && <Text style={styles.errMsg}>{deletionError}</Text>}
        <View style={styles.deletionActions}>
          <Button
            title="Retry deletion"
            fullWidth
            loading={deletionAction === 'retry'}
            disabled={deletionAction !== null}
            onPress={() => {
              setDeletionAction('retry')
              setDeletionError(null)
              void deleteAccount().then((result) => {
                if (!result.success) setDeletionError('Could not finish deletion. Check your connection and retry.')
              }).finally(() => setDeletionAction(null))
            }}
            testID="account-deletion-retry"
          />
          {canReturnFromDeletion && (
            <Button
              title="Return to account"
              variant="secondary"
              fullWidth
              loading={deletionAction === 'return'}
              disabled={deletionAction !== null}
              onPress={() => {
                setDeletionAction('return')
                setDeletionError(null)
                void returnToAccountFromDeletion().then((result) => {
                  if (!result.success) {
                    setCanReturnFromDeletion(false)
                    setDeletionError(result.error.message)
                  }
                }).finally(() => setDeletionAction(null))
              }}
              testID="account-deletion-return"
            />
          )}
        </View>
      </View>
    )
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
  // Covers every route — including auth, pairing, and recovery — before a task
  // snapshot can expose a secret when the app becomes inactive/backgrounded.
  const [privacyCovered, setPrivacyCovered] = useState(AppState.currentState !== 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setPrivacyCovered(state !== 'active'))
    return () => sub.remove()
  }, [])

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
        {privacyCovered && <View pointerEvents="auto" style={privacyCoverStyles.cover} testID="privacy-cover" />}
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

const privacyCoverStyles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: '#121613' },
})

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.bg, padding: t.spacing['2xl'] },
    errTitle: { fontSize: 20, fontWeight: '700', color: t.colors.danger },
    errMsg: { fontSize: 14, color: t.colors.textSecondary, marginTop: t.spacing.sm, textAlign: 'center' },
    deletionActions: { alignSelf: 'stretch', gap: t.spacing.md, marginTop: t.spacing.xl },
  })
