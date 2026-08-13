import { useCallback, useEffect, useRef, useState } from 'react'

import { areModelsReady } from '@/services/llm/model-manager'
import { getEntry } from '@/services/storage/entries'
import { listContributions } from '@/services/storage/wiki-contributions'

export type EntryLifecycleStatus = 'saved' | 'pending' | 'unavailable' | 'retryable' | 'ready'

interface EntryLifecycle {
  status: EntryLifecycleStatus
  refresh: () => void
}

function hasWrittenReflection(entry: { situation: string; thought: string }): boolean {
  return entry.situation.trim().length > 0 || entry.thought.trim().length > 0
}

export function useEntryLifecycle(entryId?: string): EntryLifecycle {
  const [status, setStatus] = useState<EntryLifecycleStatus>('saved')
  const requestRef = useRef(0)

  const refresh = useCallback(() => {
    const request = ++requestRef.current
    if (!entryId) {
      setStatus('retryable')
      return
    }

    void (async () => {
      const [entryRes, contributionRes] = await Promise.all([
        getEntry(entryId),
        listContributions(entryId),
      ])
      if (request !== requestRef.current) return
      if (!entryRes.success || !contributionRes.success || !entryRes.data) {
        setStatus('retryable')
        return
      }
      if (contributionRes.data.length > 0) {
        setStatus('ready')
        return
      }
      if (!hasWrittenReflection(entryRes.data) || entryRes.data.wiki_indexed_at != null) {
        setStatus('unavailable')
        return
      }
      setStatus((await areModelsReady()) ? 'pending' : 'unavailable')
    })()
  }, [entryId])

  useEffect(() => {
    if (!entryId) {
      setStatus('retryable')
      return
    }
    refresh()
    const interval = setInterval(refresh, 1000)
    return () => {
      clearInterval(interval)
      requestRef.current += 1
    }
  }, [entryId, refresh])

  return { status, refresh }
}

