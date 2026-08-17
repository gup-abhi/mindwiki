import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listStreakTimestamps } from '@/services/storage/entries'
import { useSyncStore } from '@/store/sync.store'

/**
 * created_at for every entry that counts toward the streak — journal entries and
 * completed guided-path answers (not incidental Reflect captures). Separate from
 * useEntries, which is the journal timeline only. Refreshes on focus and after a
 * sync pull, so a path finished elsewhere shows up.
 */
export function useStreakTimestamps() {
  const [timestamps, setTimestamps] = useState<number[]>([])
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    const result = await listStreakTimestamps()
    if (result.success) setTimestamps(result.data)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void revision
      refresh()
    }, [refresh, revision])
  )

  return { timestamps, refresh }
}
