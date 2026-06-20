import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import {
  correctPage,
  deleteEmptyPages,
  dismissPage,
  getPage,
  listDismissedPages,
  listPages,
  restorePage,
  type WikiPage,
} from '@/services/storage/wiki'
import { lineageForEntry, regeneratePageVoice, type LineagePage } from '@/services/wiki/engine'
import { type Entry } from '@/services/storage/entries'
import { useSyncStore } from '@/store/sync.store'

/** All wiki pages; refreshed on focus and after a sync pull. */
export function useWikiPages() {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [loading, setLoading] = useState(true)
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    // Self-heal any legacy blank shells before listing (best-effort).
    await deleteEmptyPages()
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
  const [regenerating, setRegenerating] = useState(false)

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

  // Drop this page as inaccurate (or restore it). Updates local state optimistically
  // so the screen flips to the dropped/active banner without a reload.
  const dismiss = useCallback(async () => {
    if (!id) return
    const res = await dismissPage(id)
    if (res.success) setPage((p) => (p ? { ...p, dismissed_at: Date.now() } : p))
  }, [id])

  const restore = useCallback(async () => {
    if (!id) return
    const res = await restorePage(id)
    if (res.success) setPage((p) => (p ? { ...p, dismissed_at: null } : p))
  }, [id])

  // Rewrite the page in the user's own words. Reflects the new content, bumped
  // version, and corrected/active flags locally so the screen updates in place.
  const correct = useCallback(async (text: string) => {
    if (!id) return
    const res = await correctPage(id, text)
    if (res.success) setPage(res.data)
  }, [id])

  // Re-run the deep model to rewrite this page in the canonical voice (substance
  // unchanged). Resolves to null on success, or an error message the screen can
  // surface (so a real failure isn't silent). Reflects the new content locally.
  const regenerate = useCallback(async (): Promise<string | null> => {
    if (!page) return 'No page loaded.'
    setRegenerating(true)
    const res = await regeneratePageVoice(page)
    if (res.success) setPage(res.data)
    setRegenerating(false)
    return res.success ? null : res.error.message
  }, [page])

  return { page, loading, dismiss, restore, correct, regenerate, regenerating }
}

/** Pages the user has dropped as inaccurate; refreshed on focus. */
export function useDismissedPages() {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await listDismissedPages()
    if (res.success) setPages(res.data)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  return { pages, loading, refresh }
}

/** The live wiki pages an entry shaped — for the entry-detail lineage. Reloads
 * when the entry (re-tags) or a sync pull changes. */
export function useEntryLineage(entry: Entry | null): LineagePage[] {
  const [pages, setPages] = useState<LineagePage[]>([])
  const revision = useSyncStore((s) => s.revision)

  useEffect(() => {
    let active = true
    if (!entry) {
      setPages([])
      return
    }
    lineageForEntry(entry).then((res) => {
      if (active && res.success) setPages(res.data)
    })
    return () => {
      active = false
    }
  }, [entry, revision])

  return pages
}
