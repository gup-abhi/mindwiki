import { useCallback, useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import NetInfo from '@react-native-community/netinfo'

import { sync } from '@/services/sync/engine'
import { useAuthStore } from '@/store/auth.store'
import { useSyncStore } from '@/store/sync.store'

// Collapse a burst of enqueues (one entry can touch several wiki pages) into a
// single push, and let background-generated records settle before syncing.
const LOCAL_CHANGE_DEBOUNCE_MS = 2000

/**
 * Opportunistic background sync: runs one push+pull pass when the user is
 * authenticated — on mount / when the session becomes authenticated, when the
 * app returns to the foreground, when connectivity is regained (so an entry
 * written offline uploads the moment the network comes back), and — debounced —
 * whenever a local record is created/updated (it's enqueued, which bumps
 * pendingSignal). Guarded against overlapping runs. Best-effort: sync() never
 * throws and no-ops without a session + master key, so this is safe to mount
 * unconditionally; offline journaling is never affected.
 */
export function useSync(): void {
  const status = useAuthStore((s) => s.status)
  const pendingSignal = useSyncStore((s) => s.pendingSignal)
  const running = useRef(false)
  const wasConnected = useRef(true)

  const run = useCallback(() => {
    if (useAuthStore.getState().status !== 'authenticated' || running.current) return
    running.current = true
    void sync().finally(() => {
      running.current = false
    })
  }, [])

  useEffect(() => {
    run()
    const appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') run()
    })
    // Flush the pending queue the instant connectivity is restored (offline→online
    // transition only, so we don't re-sync on every network event).
    const netUnsub = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true
      if (connected && !wasConnected.current) run()
      wasConnected.current = connected
    })
    return () => {
      appSub.remove()
      netUnsub()
    }
  }, [status, run])

  // A local change was enqueued → push it without waiting for a foreground or a
  // manual tap. Debounced so a burst collapses into one sync. pendingSignal===0
  // is the initial state (mount already syncs above), so skip it.
  useEffect(() => {
    if (pendingSignal === 0) return
    const t = setTimeout(run, LOCAL_CHANGE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [pendingSignal, run])
}
