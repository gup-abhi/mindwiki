import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listPages, getPage, type WikiPage } from '@/services/storage/wiki'
import { useSyncStore } from '@/store/sync.store'

/** All wiki pages; refreshed on focus and after a sync pull. */
export function useWikiPages() {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [loading, setLoading] = useState(true)
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    const result = await listPages()
    if (result.success) setPages(result.data)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh, revision])
  )

  return { pages, loading }
}

/** A single wiki page by id. */
export function useWikiPage(id: string | undefined) {
  const [page, setPage] = useState<WikiPage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!id) {
      setLoading(false)
      return
    }
    getPage(id).then((result) => {
      if (!active) return
      if (result.success) setPage(result.data)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [id])

  return { page, loading }
}
