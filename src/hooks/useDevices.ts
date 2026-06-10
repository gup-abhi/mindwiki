import { useCallback, useEffect, useState } from 'react'

import { listDevices, type PairedDevice } from '@/services/auth/devices'

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

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { devices, loading, refresh }
}
