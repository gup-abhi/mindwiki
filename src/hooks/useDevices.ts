import { useCallback, useEffect, useMemo, useState } from 'react'

import { getDeviceId } from '@/services/auth/device-id'
import { listDevices, logoutDevice, type PairedDevice } from '@/services/auth/devices'

/** Loads account paired-device log. Device actions fail closed until identity resolves. */
export function useDevices() {
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [identityResolved, setIdentityResolved] = useState(false)
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getDeviceId().then((id) => {
      setCurrentDeviceId(id)
      setIdentityResolved(true)
    }).catch(() => {
      // Keep device rows read-only when identity cannot be established.
      setIdentityResolved(false)
    })
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await listDevices()
    setLoading(false)
    if (res.success) {
      setDevices(res.data)
      setError(null)
    } else setError(res.error.message)
  }, [])

  const signOut = useCallback(async (id: string) => {
    if (!identityResolved || (currentDeviceId && id === currentDeviceId) || busyDeviceId) return
    setBusyDeviceId(id)
    setError(null)
    const res = await logoutDevice(id, currentDeviceId)
    if (res.success) await refresh()
    else setError(res.error.message)
    setBusyDeviceId(null)
  }, [identityResolved, currentDeviceId, busyDeviceId, refresh])

  useEffect(() => { void refresh() }, [refresh])

  const ordered = useMemo(() => {
    if (!identityResolved || !currentDeviceId) return devices
    const self = devices.filter((d) => d.id === currentDeviceId)
    const rest = devices.filter((d) => d.id !== currentDeviceId)
    return [...self, ...rest]
  }, [devices, currentDeviceId, identityResolved])

  return {
    devices: ordered,
    loading,
    currentDeviceId: identityResolved ? currentDeviceId : null,
    identityResolved,
    busyDeviceId,
    error,
    refresh,
    logoutDevice: signOut,
  }
}