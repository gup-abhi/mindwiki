import { useCallback, useEffect, useState } from 'react'

import { type ModelKind } from '@/native/LLMBridge'
import { areModelsReady, canStart, downloadModel, onDeepModelReady, clearDeepModelReadyCallbacks } from '@/services/llm/model-manager'
import { triggerCatchUp } from '@/services/pipeline'

// Required models block app readiness; the embed model is optional (Reflect
// degrades to lexical ranking without it) so its failure must NOT fail the flow.
const REQUIRED: ModelKind[] = ['fast', 'deep']
const ORDER: ModelKind[] = [...REQUIRED, 'embed']

/**
 * Checks whether the on-device AI models are present and drives their download.
 * `ready` is null while checking, then boolean. Supports staged download:
 * `canStart` gates on fast model only; deep model downloads in background.
 * `deepProgress` is non-null while the deep model is downloading but the app
 * is already usable. Never throws.
 */
export function useModelDownload() {
  const [ready, setReady] = useState<boolean | null>(null)
  const [canStartNow, setCanStartNow] = useState<boolean | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [deepProgress, setDeepProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Guard against setState after unmount (the readiness check is async).
  useEffect(() => {
    let cancelled = false
    void areModelsReady().then((r) => {
      if (!cancelled) setReady(r)
    })
    void canStart().then((r) => {
      if (!cancelled) setCanStartNow(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const download = useCallback(async () => {
    setDownloading(true)
    setError(null)
    setProgress(0)
    setDeepProgress(null)

    // Phase 0: fast model (required to start journaling).
    const fastRes = await downloadModel('fast', (p) => setProgress(p / ORDER.length))
    if (!fastRes.success) {
      setDownloading(false)
      setError('Download failed. Check your connection and try again.')
      return
    }
    setCanStartNow(true)
    setProgress(1 / ORDER.length)

    // Phase 1: deep model — download in background while the app is usable.
    // Show secondary progress for this phase.
    setDeepProgress(0)
    void downloadModel('deep', (p) => setDeepProgress(p)).then((deepRes) => {
      if (deepRes.success) {
        setDeepProgress(1)
        void triggerCatchUp()
        // Phase 2: embed model (optional, best-effort)
        void downloadModel('embed', (p) => setProgress((2 + p) / ORDER.length)).then(() => {
          setProgress(1)
          setDownloading(false)
          // Only set ready once both deep and embed are done.
          setReady(true)
        })
        // If the embed download fails, we're still ready — ensureEmbedModel
        // retries it later.
      } else {
        setDeepProgress(null)
        setDownloading(false)
        setError('Deep model download failed. Some features will be limited.')
      }
    })
  }, [])

  return { ready, canStart: canStartNow, downloading, progress, deepProgress, error, download }
}
