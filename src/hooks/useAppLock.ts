import { useEffect } from 'react'
import { AppState } from 'react-native'

import { canAuthenticate, isLockEnabled } from '@/services/auth/biometric'
import { useLockStore } from '@/store/lock.store'

/**
 * Drives the app-lock. Mounted once inside the authenticated subtree:
 *  - At launch, resolves the effective lock state (user preference AND the device
 *    can authenticate) and locks immediately if on (cold-start lock).
 *  - Re-locks when the app returns to the foreground after the grace period.
 * Returns whether the lock overlay should be shown.
 */
export function useAppLock(): boolean {
  const locked = useLockStore((s) => s.locked)

  useEffect(() => {
    let active = true
    void (async () => {
      const [pref, capable] = await Promise.all([isLockEnabled(), canAuthenticate()])
      if (!active) return
      const enabled = pref && capable
      useLockStore.getState().setEnabled(enabled)
      if (enabled) useLockStore.getState().requireUnlock()
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useLockStore.getState().onForeground()
      else if (state === 'background' || state === 'inactive') useLockStore.getState().onBackground()
    })
    return () => sub.remove()
  }, [])

  return locked
}
