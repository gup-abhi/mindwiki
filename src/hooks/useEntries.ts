import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listEntries, type Entry } from '@/services/storage/entries'

/** Loads entries from storage and refreshes whenever the screen regains focus. */
export function useEntries() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const result = await listEntries()
    if (result.success) setEntries(result.data)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh])
  )

  return { entries, count: entries.length, loading, refresh }
}
