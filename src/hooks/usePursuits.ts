import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import {
  deletePursuit,
  listPursuits,
  updatePursuit,
  type Pursuit,
  type PursuitStatus,
} from '@/services/storage/pursuits'

/**
 * Manage screen state: the full list of pursuits (refreshed on focus) plus
 * actions to change a pursuit's status or remove it. Reactivating restarts the
 * check-in cadence cleanly; closing just sets the status.
 */
export function usePursuits() {
  const [pursuits, setPursuits] = useState<Pursuit[]>([])

  const refresh = useCallback(async () => {
    const res = await listPursuits()
    if (res.success) setPursuits(res.data)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  const setStatus = useCallback(
    async (id: string, status: PursuitStatus) => {
      const patch =
        status === 'active'
          ? { status, last_mentioned_at: Date.now(), checkin_question: '' }
          : { status }
      await updatePursuit(id, patch)
      await refresh()
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      await deletePursuit(id)
      await refresh()
    },
    [refresh]
  )

  return { pursuits, setStatus, remove }
}
