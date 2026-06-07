import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import NetInfo from '@react-native-community/netinfo'

import { sync } from '@/services/sync/engine'
import { useAuthStore } from '@/store/auth.store'

/**
 * Opportunistic background sync: runs one push+pull pass when the user is
 * authenticated — on mount / when the session becomes authenticated, when the
 * app returns to the foreground, and when connectivity is regained (so an entry
 * written offline uploads the moment the network comes back). Guarded against
 * overlapping runs. Best-effort: sync() never throws and no-ops without a session
 * + master key, so this is safe to mount unconditionally; offline journaling is
 * never affected.
 */
export function useSync(): void {
  const status = useAuthStore((s) => s.status)
  const running = useRef(false)
  const wasConnected = useRef(true)

  useEffect(() => {
    const run = () => {
      if (useAuthStore.getState().status !== 'authenticated' || running.current) return
      running.current = true
      void sync().finally(() => {
        running.current = false
      })
    }

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
  }, [status])
}
