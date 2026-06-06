import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listEntries, getEntry, type Entry } from '@/services/storage/entries'
import { useSyncStore } from '@/store/sync.store'

/** Loads entries from storage; refreshes on focus and after a sync pull. */
export function useEntries() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    const result = await listEntries()
    if (result.success) setEntries(result.data)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh, revision])
  )

  return { entries, count: entries.length, loading, refresh }
}

/** A single entry by id, for the read-only detail view. */
export function useEntry(id: string | undefined) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!id) {
      setLoading(false)
      return
    }
    getEntry(id).then((result) => {
      if (!active) return
      if (result.success) setEntry(result.data)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [id])

  return { entry, loading }
}
