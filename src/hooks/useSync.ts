import { useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { sync } from '@/services/sync/engine'
import { useAuthStore } from '@/store/auth.store'

/**
 * Opportunistic background sync: runs one push+pull pass when the user is
 * authenticated — on mount / when the session becomes authenticated, and again
 * whenever the app returns to the foreground. Guarded against overlapping runs.
 * Best-effort: sync() never throws and no-ops without a session + master key, so
 * this is safe to mount unconditionally; offline journaling is never affected.
 */
export function useSync(): void {
  const status = useAuthStore((s) => s.status)
  const running = useRef(false)

  useEffect(() => {
    const run = () => {
      if (useAuthStore.getState().status !== 'authenticated' || running.current) return
      running.current = true
      void sync().finally(() => {
        running.current = false
      })
    }

    run()
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') run()
    })
    return () => subscription.remove()
  }, [status])
}
