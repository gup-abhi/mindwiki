import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listEntries, getEntry, type Entry } from '@/services/storage/entries'

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
