import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

import { generateDigest, type Digest } from '@/services/digest/generator'
import { enrichWithQuestion } from '@/services/digest/question'
import { listEntries } from '@/services/storage/entries'

/**
 * Loads entries and builds the weekly digest. Shows the templated digest
 * immediately, then swaps in the LLM-enriched reflection question once ready
 * (best-effort). Null when there aren't enough entries for a digest yet.
 */
export function useDigest() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listEntries(200)
    const base = res.success ? generateDigest(res.data, Date.now()) : null
    setDigest(base)
    setLoading(false)
    if (base) setDigest(await enrichWithQuestion(base))
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  return { digest, loading }
}
