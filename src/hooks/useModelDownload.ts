import { useCallback, useEffect, useState } from 'react'

import { type ModelKind } from '@/native/LLMBridge'
import { areModelsReady, downloadModel } from '@/services/llm/model-manager'

const ORDER: ModelKind[] = ['fast', 'deep']

/**
 * Checks whether the on-device AI models are present and drives their download.
 * `ready` is null while checking, then true/false. Download runs the missing
 * models in order, reporting a combined 0..1 progress. Never throws.
 */
export function useModelDownload() {
  const [ready, setReady] = useState<boolean | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Guard against setState after unmount (the readiness check is async).
  useEffect(() => {
    let cancelled = false
    void areModelsReady().then((r) => {
      if (!cancelled) setReady(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const download = useCallback(async () => {
    setDownloading(true)
    setError(null)
    setProgress(0)
    for (let i = 0; i < ORDER.length; i++) {
      const res = await downloadModel(ORDER[i], (p) => setProgress((i + p) / ORDER.length))
      if (!res.success) {
        setDownloading(false)
        setError('Download failed. Check your connection and try again.')
        return
      }
    }
    setProgress(1)
    setDownloading(false)
    setReady(true)
  }, [])

  return { ready, downloading, progress, error, download }
}
