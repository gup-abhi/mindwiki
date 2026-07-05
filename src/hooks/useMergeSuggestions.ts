import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { listPages } from '@/services/storage/wiki'
import { listPageEmbeddings } from '@/services/storage/page-embeddings'
import { getSetting, setSetting } from '@/services/storage/settings'
import { suggestMerges, mergePages, pairKey, type MergePair } from '@/services/wiki/merge'
import { useSyncStore } from '@/store/sync.store'

/** Settings key holding the JSON array of pair-keys the user chose to keep separate. */
const SUPPRESS_KEY = 'merge_suppressions_v1'

async function loadSuppressed(): Promise<Set<string>> {
  const res = await getSetting(SUPPRESS_KEY)
  if (!res.success || !res.data) return new Set()
  try {
    const arr = JSON.parse(res.data)
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set()
  } catch {
    return new Set()
  }
}

/**
 * The single strongest near-duplicate theme pair worth suggesting the user merge,
 * plus confirm/dismiss actions. Best-effort: no embeddings (embed model not run
 * yet) → no suggestion, and the Insights list is unaffected. Recomputes on focus,
 * after a sync pull, and after each action.
 */
export function useMergeSuggestions() {
  const [pair, setPair] = useState<MergePair | null>(null)
  const [busy, setBusy] = useState(false)
  const revision = useSyncStore((s) => s.revision)
  const bumpRevision = useSyncStore((s) => s.bumpRevision)

  const recompute = useCallback(async () => {
    const [pagesRes, embRes, suppressed] = await Promise.all([
      listPages(),
      listPageEmbeddings(),
      loadSuppressed(),
    ])
    if (!pagesRes.success || !embRes.success) {
      setPair(null)
      return
    }
    const vectors = new Map<string, number[]>()
    for (const [id, emb] of embRes.data) vectors.set(id, emb.vector)
    const pairs = suggestMerges(pagesRes.data, vectors, suppressed)
    setPair(pairs[0] ?? null)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void recompute()
    }, [recompute, revision])
  )

  // Merge the suggested pair. Bumps the sync revision so the wiki list and other
  // views refresh to reflect the consolidated page.
  const confirm = useCallback(async () => {
    if (!pair || busy) return
    setBusy(true)
    const res = await mergePages(pair.survivor, pair.loser)
    setBusy(false)
    if (res.success) {
      bumpRevision()
      await recompute()
    }
  }, [pair, busy, bumpRevision, recompute])

  // Keep the pair separate — persist it so it never re-suggests, then advance.
  const dismiss = useCallback(async () => {
    if (!pair || busy) return
    setBusy(true)
    const suppressed = await loadSuppressed()
    suppressed.add(pairKey(pair.survivor.title, pair.loser.title))
    await setSetting(SUPPRESS_KEY, JSON.stringify([...suppressed]))
    setBusy(false)
    await recompute()
  }, [pair, busy, recompute])

  return { pair, busy, confirm, dismiss }
}
