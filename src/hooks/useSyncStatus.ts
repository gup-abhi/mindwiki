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
  const [message, setMessage] = useState<string | null>(null)

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
    setMessage(null)
    const res = await sync()
    setSyncing(false)
    await refresh()
    if (!res.success) {
      setMessage('Sync failed — check your connection and try again.')
    } else if (res.data.pushed === 0 && res.data.pulled === 0) {
      setMessage('Everything’s already synced.')
    } else {
      setMessage(`Synced — ${res.data.pushed} uploaded, ${res.data.pulled} downloaded.`)
    }
  }, [refresh])

  return { lastPull, pending, syncing, message, syncNow }
}
