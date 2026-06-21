import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { runDigestSynthesis } from '@/services/digest/agents/orchestrator'
import { generateDigest, type Digest } from '@/services/digest/generator'
import { enrichWithQuestion } from '@/services/digest/question'
import { listEntries } from '@/services/storage/entries'
import { listEdges, listNodes } from '@/services/storage/graph'
import { listPages } from '@/services/storage/wiki'

/**
 * Loads entries and builds the weekly digest. Shows the templated digest
 * immediately, swaps in the LLM-enriched reflection question, then runs the
 * multi-agent synthesis (best-effort, all additive). Null when there aren't
 * enough entries for a digest yet.
 */
export function useDigest() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(true)
  const [synthesizing, setSynthesizing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listEntries(200)
    const entries = res.success ? res.data : []
    const base = res.success ? generateDigest(entries, Date.now()) : null
    setDigest(base)
    setLoading(false)
    if (!base) return

    // Both deep-model passes (the reflection question, then the multi-agent
    // synthesis) share one model context and can sit behind background entry
    // work. Flag it up front so the screen shows it's thinking the moment it
    // opens — not only after the first inference finishes (and not buried below
    // the fold).
    setSynthesizing(true)
    try {
      const enriched = await enrichWithQuestion(base)
      setDigest(enriched)

      const [nodesR, edgesR, pagesR] = await Promise.all([listNodes(), listEdges(), listPages()])
      setDigest(
        await runDigestSynthesis({
          digest: enriched,
          entries,
          nodes: nodesR.success ? nodesR.data : [],
          edges: edgesR.success ? edgesR.data : [],
          pages: pagesR.success ? pagesR.data : [],
        })
      )
    } finally {
      setSynthesizing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  return { digest, loading, synthesizing }
}
