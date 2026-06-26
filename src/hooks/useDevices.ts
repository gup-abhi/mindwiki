import { useCallback, useEffect, useState } from 'react'

import { listDevices, removeDevice, type PairedDevice } from '@/services/auth/devices'

/** Loads the account's paired-device log for the Settings screen. */
export function useDevices() {
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await listDevices()
    setLoading(false)
    if (res.success) setDevices(res.data)
  }, [])

  // Remove a device (e.g. a stale/old row) and reload.
  const remove = useCallback(
    async (id: string) => {
      const res = await removeDevice(id)
      if (res.success) await refresh()
    },
    [refresh]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { devices, loading, refresh, remove }
}
