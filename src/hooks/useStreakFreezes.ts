import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { freezeDays, listFrozenDays } from '@/services/storage/streak-freezes'
import { useSyncStore } from '@/store/sync.store'

/**
 * Loads the user's frozen days (the streak count is derived from entries ∪ these)
 * and exposes an action to spend freezes on missed days. Reactive on the sync
 * revision so a pulled freeze from another device shows up.
 */
export function useStreakFreezes() {
  const [frozenDays, setFrozenDays] = useState<Set<number>>(new Set())
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    const res = await listFrozenDays()
    if (res.success) setFrozenDays(res.data)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh, revision])
  )

  // Spend freezes by recording the given missed days as frozen, then reload.
  const useFreezes = useCallback(
    async (days: number[]) => {
      if (days.length === 0) return
      await freezeDays(days)
      await refresh()
    },
    [refresh]
  )

  return { frozenDays, useFreezes, refresh }
}
