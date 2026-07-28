import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import {
  countJournalEntries,
  getEntry,
  getJournalEntryNeighbors,
  listEntries,
  listJournalEmotions,
  listJournalEntriesPage,
  type Entry,
  type EntryCursor,
  type JournalEntryNeighbors,
} from '@/services/storage/entries'
import { type AppError } from '@/types/result'
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

/** True lifetime journal count. Separate from useEntries, whose 50-row contract remains. */
export function useJournalEntryCount() {
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const revision = useSyncStore((s) => s.revision)

  const refresh = useCallback(async () => {
    // Older screen tests mock only listEntries. Keep this hook harmless under
    // those mocks; production always has the storage API.
    if (typeof countJournalEntries !== 'function') {
      setLoading(false)
      return
    }
    try {
      const result = await countJournalEntries()
      if (result.success) setCount(result.data)
    } catch {
      // The screen remains usable when storage is not initialized in a test or transient mount.
    }
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh, revision])
  )

  return { count, loading, refresh }
}

export interface EntryArchiveState {
  entries: Entry[]
  query: string
  emotion: string | null
  loading: boolean
  loadingMore: boolean
  error: AppError | null
  total: number
  emotions: string[]
  hasMore: boolean
  setQuery: (query: string) => void
  setEmotion: (emotion: string | null) => void
  loadMore: () => void
  refresh: () => Promise<void>
}

const ARCHIVE_PAGE_SIZE = 30
const SEARCH_DEBOUNCE_MS = 250

/** Full local journal archive state: debounced search, keyset pagination, and race guards. */
export function useEntryArchive(): EntryArchiveState {
  const [entries, setEntries] = useState<Entry[]>([])
  const [query, setQuery] = useState('')
  const [emotion, setEmotion] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [total, setTotal] = useState(0)
  const [emotions, setEmotions] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<EntryCursor | null>(null)
  const revision = useSyncStore((s) => s.revision)
  const generation = useRef(0)
  const firstQueryEffect = useRef(true)
  const initializedRef = useRef(false)
  const queryRef = useRef(query)
  const emotionRef = useRef(emotion)
  const cursorRef = useRef(cursor)
  const hasMoreRef = useRef(hasMore)
  const loadingMoreRef = useRef(loadingMore)

  queryRef.current = query
  emotionRef.current = emotion
  cursorRef.current = cursor
  hasMoreRef.current = hasMore
  loadingMoreRef.current = loadingMore

  const loadFirstPage = useCallback(async (nextQuery: string, nextEmotion: string | null) => {
    const request = ++generation.current
    setLoading(true)
    setError(null)
    setCursor(null)
    cursorRef.current = null
    try {
      const [page, count, emotionList] = await Promise.all([
        listJournalEntriesPage({ limit: ARCHIVE_PAGE_SIZE, query: nextQuery, emotion: nextEmotion }),
        countJournalEntries(),
        listJournalEmotions(),
      ])
      if (request !== generation.current) return
      if (!page.success) {
        setError(page.error)
        setEntries([])
        setHasMore(false)
      } else {
        setEntries(page.data.items)
        setCursor(page.data.nextCursor)
        cursorRef.current = page.data.nextCursor
        setHasMore(page.data.hasMore)
        hasMoreRef.current = page.data.hasMore
      }
      if (count.success) setTotal(count.data)
      if (emotionList.success) setEmotions(emotionList.data)
    } catch (cause) {
      if (request === generation.current) {
        setError({ code: 'ENTRY_ARCHIVE_LOAD_FAILED', message: 'Failed to load journal archive', cause })
        setEntries([])
        setHasMore(false)
      }
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await loadFirstPage(queryRef.current, emotionRef.current)
  }, [loadFirstPage])

  // Initial load and focus/sync refresh. Query changes use the debounced effect below.
  useFocusEffect(
    useCallback(() => {
      initializedRef.current = true
      void refresh()
    }, [refresh, revision])
  )

  useEffect(() => {
    if (firstQueryEffect.current) {
      firstQueryEffect.current = false
      return
    }
    if (!initializedRef.current) return
    const timer = setTimeout(() => {
      void loadFirstPage(query, emotion)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, emotion, loadFirstPage])

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current || !cursorRef.current) return
    const request = generation.current
    const pageCursor = cursorRef.current
    setLoadingMore(true)
    loadingMoreRef.current = true
    void listJournalEntriesPage({
      limit: ARCHIVE_PAGE_SIZE,
      query: queryRef.current,
      emotion: emotionRef.current,
      cursor: pageCursor,
    }).then((page) => {
      if (request !== generation.current) return
      if (!page.success) {
        setError(page.error)
        return
      }
      setEntries((current) => {
        const ids = new Set(current.map((entry) => entry.id))
        return [...current, ...page.data.items.filter((entry) => !ids.has(entry.id))]
      })
      setCursor(page.data.nextCursor)
      cursorRef.current = page.data.nextCursor
      setHasMore(page.data.hasMore)
      hasMoreRef.current = page.data.hasMore
    }).catch((cause: unknown) => {
      if (request === generation.current) {
        setError({ code: 'ENTRY_ARCHIVE_LOAD_MORE_FAILED', message: 'Failed to load more entries', cause })
      }
    }).finally(() => {
      if (request === generation.current) {
        setLoadingMore(false)
        loadingMoreRef.current = false
      }
    })
  }, [])

  return { entries, query, emotion, loading, loadingMore, error, total, emotions, hasMore, setQuery, setEmotion, loadMore, refresh }
}

/** Loads adjacent journal entries from storage, independent of the 50-row timeline. */
export function useEntryNeighbors(entry: Entry | null) {
  const [neighbors, setNeighbors] = useState<JournalEntryNeighbors>({ older: null, newer: null })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    if (!entry) {
      setNeighbors({ older: null, newer: null })
      setLoading(false)
      return
    }
    setLoading(true)
    getJournalEntryNeighbors(entry).then((result) => {
      if (!active) return
      if (result.success) setNeighbors(result.data)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [entry])

  return { ...neighbors, loading }
}
