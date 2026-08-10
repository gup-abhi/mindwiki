import { useCallback, useEffect, useState } from 'react'

import { sync } from '@/services/sync/engine'
import { getSetting } from '@/services/storage/settings'
import { pendingUploads } from '@/services/storage/sync-queue'
import { useSyncStore } from '@/store/sync.store'

/**
 * Read-only view of sync state for the Settings screen: when the last sync
 * completed and how many local changes are still waiting to upload, plus a
 * manual "sync now". Refreshes whenever a background pull bumps the sync revision.
 */
export function useSyncStatus() {
  const revision = useSyncStore((s) => s.revision)
  const [lastSynced, setLastSynced] = useState<number | null>(null)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<number | null> => {
    // Wall-clock time of the last successful sync — not sync:last_pull, which is
    // a data cursor that stays put when there's nothing newer to pull.
    const ls = await getSetting('sync:last_synced_at')
    if (ls.success) setLastSynced(ls.data ? Number(ls.data) : null)
    const pend = await pendingUploads()
    if (!pend.success) return null
    setPending(pend.data.length)
    return pend.data.length
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, revision])

  const syncNow = useCallback(async (): Promise<boolean> => {
    setSyncing(true)
    setMessage(null)
    let previousRemaining: number | null = null
    let pushed = 0
    let pulled = 0

    try {
      while (true) {
        const res = await sync()
        const remaining = await refresh()
        if (!res.success || remaining === null) {
          setMessage('Sync failed — check your connection and try again.')
          return false
        }
        pushed += res.data.pushed
        pulled += res.data.pulled
        if (remaining === 0) {
          if (pushed === 0 && pulled === 0) setMessage('Everything’s already synced.')
          else setMessage(`Synced — ${pushed} uploaded, ${pulled} downloaded.`)
          return true
        }
        // A pull can enqueue a local conflict winner after this pass's push. Run
        // another pass while uploads are making progress; stop fail-closed after
        // two consecutive snapshots show no upload progress.
        if (previousRemaining !== null && remaining >= previousRemaining && res.data.pushed === 0) {
          setMessage(`${remaining} ${remaining === 1 ? 'change is' : 'changes are'} still waiting to upload.`)
          return false
        }
        previousRemaining = remaining
      }
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  return { lastSynced, pending, syncing, message, syncNow }
}
