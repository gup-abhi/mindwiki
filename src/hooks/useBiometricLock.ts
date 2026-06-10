import { useCallback, useEffect, useState } from 'react'

import { canAuthenticate, isLockEnabled, setLockEnabled } from '@/services/auth/biometric'
import { useLockStore } from '@/store/lock.store'

/**
 * Settings control for the app-lock preference. Surfaces the saved preference and
 * whether the device can authenticate; toggling persists it and updates the live
 * gate (effective = preference AND device-capable).
 */
export function useBiometricLock() {
  const [enabled, setEnabled] = useState(true)
  const [capable, setCapable] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      const [pref, can] = await Promise.all([isLockEnabled(), canAuthenticate()])
      if (!active) return
      setEnabled(pref)
      setCapable(can)
    })()
    return () => {
      active = false
    }
  }, [])

  const toggle = useCallback(async () => {
    const next = !enabled
    setEnabled(next)
    await setLockEnabled(next)
    useLockStore.getState().setEnabled(next && capable)
  }, [enabled, capable])

  return { enabled, capable, toggle }
}
