import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'

import { firstRunStatus } from '@/services/onboarding/first-run'

let _firstRunRedirectedOnce = false

/**
 * Reset the once-per-session redirect guard. Called on logout so that a
 * different account signing in on the same app session can still be routed
 * through its own first-run path (the guard is a session-global, not a
 * per-account flag).
 */
export function resetFirstRunRedirect(): void {
  _firstRunRedirectedOnce = false
}

/**
 * Redirect the user through the first-run guided path once per device install.
 * Called from AppRoot after the onboarding carousel is dismissed. Detects
 * whether a first run is pending and, if so, replaces the current route with
 * the first-run path. Idempotent — only fires once per session.
 *
 * After the path completes, the path runner handles routing to the first wiki
 * page (or Home). Nothing in this hook blocks anything.
 */
export function useFirstRunRedirect(): void {
  const router = useRouter()

  useEffect(() => {
    if (_firstRunRedirectedOnce) return
    _firstRunRedirectedOnce = true

    void firstRunStatus().then((status) => {
      if (status.shouldRun) {
        router.replace({
          pathname: `/paths/${status.pathId}`,
          params: { firstRun: '1' },
        })
      }
    })
  }, [router])
}
