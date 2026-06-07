import { useCallback, useEffect, useState } from 'react'

import { sync } from '@/services/sync/engine'
import { getSetting } from '@/services/storage/settings'
import { pendingUploads } from '@/services/storage/sync-queue'
import { useSyncStore } from '@/store/sync.store'

/**
 * Read-only view of sync state for the Settings screen: when the last pull
 * landed and how many local changes are still waiting to upload, plus a manual
 * "sync now". Refreshes whenever a background pull bumps the sync revision.
 */
export function useSyncStatus() {
  const revision = useSyncStore((s) => s.revision)
  const [lastPull, setLastPull] = useState<number | null>(null)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(async () => {
    const lp = await getSetting('sync:last_pull')
    if (lp.success) setLastPull(lp.data ? Number(lp.data) : null)
    const pend = await pendingUploads()
    if (pend.success) setPending(pend.data.length)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, revision])

  const syncNow = useCallback(async () => {
    setSyncing(true)
    await sync()
    setSyncing(false)
    await refresh()
  }, [refresh])

  return { lastPull, pending, syncing, syncNow }
}
