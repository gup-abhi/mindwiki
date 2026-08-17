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
import { pageEvolution, type EvolutionData } from '@/services/wiki/evolution'
import { lineageForEntry, regeneratePageVoice, type LineagePage } from '@/services/wiki/engine'
import { type Entry } from '@/services/storage/entries'
import {
  computePageTrend,
  computeTrendingPages,
  loadConceptEntries,
  type PageTrend,
  type PageTrendEntry,
} from '@/services/insights/page-trend'
import { useEntries } from '@/hooks/useEntries'
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
      void revision
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
  const revision = useSyncStore((s) => s.revision)

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
  }, [id, revision])

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

/**
 * How the concept behind a wiki page has trended over the last 8 weeks — its
 * frequency (as a share of your entries) and the mood on the days it appears.
 * Computed from entry tags, so it's immune to wiki-page drift. Null until loaded
 * or when there's too little data. Reloads on focus and after a sync pull.
 */
export function usePageTrend(page: WikiPage | null): PageTrend | null {
  const [trend, setTrend] = useState<PageTrend | null>(null)
  const { entries } = useEntries() // every entry — the denominator for share
  const revision = useSyncStore((s) => s.revision)
  const category = page?.category ?? null
  const title = page?.title ?? null

  useFocusEffect(
    useCallback(() => {
      void revision
      let active = true
      void (async () => {
        if (!title) {
          setTrend(null)
          return
        }
        const res = await loadConceptEntries(category, title)
        if (!active) return
        setTrend(res.success ? computePageTrend(res.data, entries, Date.now(), title) : null)
      })()
      return () => {
        active = false
      }
    }, [category, title, entries, revision])
  )

  return trend
}

/**
 * Every wiki page that has a real, nameable trend right now ("what's changing"),
 * strongest-first — for the Trends screen. Pages without enough data or without a
 * genuine shift are left out. Reloads on focus and after a sync pull.
 */
export function useTrendingPages(): PageTrendEntry[] {
  const [items, setItems] = useState<PageTrendEntry[]>([])
  const { entries } = useEntries()
  const revision = useSyncStore((s) => s.revision)

  useFocusEffect(
    useCallback(() => {
      void revision
      let active = true
      void (async () => {
        const res = await listPages() // non-dismissed pages
        if (!active || !res.success) return
        const trending = await computeTrendingPages(res.data, entries, Date.now())
        if (active) setItems(trending)
      })()
      return () => {
        active = false
      }
    }, [entries, revision])
  )

  return items
}

/**
 * Evolution timeline for a single wiki page: the ordered list of versions
 * (from version_history) plus the current state. Null when the page has no
 * history yet. Re-computes when the page's version or version_history changes.
 */
export function usePageEvolution(pageId: string | undefined): {
  evolution: EvolutionData | null
  loading: boolean
} {
  const [evolution, setEvolution] = useState<EvolutionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!pageId) {
      setEvolution(null)
      setLoading(false)
      return
    }
    void getPage(pageId).then((res) => {
      if (!active) return
      if (res.success && res.data && res.data.version_history.length > 0) {
        setEvolution(pageEvolution(res.data))
      } else {
        setEvolution(null)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [pageId])

  return { evolution, loading }
}
