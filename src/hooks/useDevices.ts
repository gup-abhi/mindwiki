import { useCallback, useEffect, useMemo, useState } from 'react'

import { getDeviceId } from '@/services/auth/device-id'
import { listDevices, logoutDevice, type PairedDevice } from '@/services/auth/devices'

/** Loads the account's paired-device log for the Settings screen. */
export function useDevices() {
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)

  useEffect(() => {
    void getDeviceId().then(setCurrentDeviceId)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await listDevices()
    setLoading(false)
    if (res.success) setDevices(res.data)
  }, [])

  // Sign another device out (or clear a stale row) and reload.
  const signOut = useCallback(
    async (id: string) => {
      const res = await logoutDevice(id)
      if (res.success) await refresh()
    },
    [refresh]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Surface this device first so the user immediately recognizes it (and it has
  // no sign-out action — they log out via the normal Log out button).
  const ordered = useMemo(() => {
    if (!currentDeviceId) return devices
    const self = devices.filter((d) => d.id === currentDeviceId)
    const rest = devices.filter((d) => d.id !== currentDeviceId)
    return [...self, ...rest]
  }, [devices, currentDeviceId])

  return { devices: ordered, loading, currentDeviceId, refresh, logoutDevice: signOut }
}
