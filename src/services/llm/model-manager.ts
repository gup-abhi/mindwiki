import * as FileSystem from 'expo-file-system'

import { type ModelKind } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'

interface ModelSpec {
  filename: string
  url: string
  approxBytes: number
}

// Qwen2.5 Instruct GGUF (Q4_K_M) — public, no auth. Matches models/README.md.
export const MODELS: Record<ModelKind, ModelSpec> = {
  fast: {
    filename: 'fast-model.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    approxBytes: 940_000_000,
  },
  deep: {
    filename: 'deep-model.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    approxBytes: 1_900_000_000,
  },
  // Dedicated sentence-embedding model (bge-small-en-v1.5, 384-dim, F16 ~67MB)
  // for semantic wiki retrieval in Reflect. Optional — a missing embed model
  // degrades to lexical ranking, so its download is non-fatal.
  embed: {
    filename: 'embed-model.gguf',
    url: 'https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-f16.gguf',
    approxBytes: 67_000_000,
  },
}

/**
 * The ONE place models live: the app's document directory. Both the downloader
 * and the LLM bridge derive paths from here, so a downloaded file is always
 * exactly where the loader looks for it.
 */
export const MODELS_DIR = `${FileSystem.documentDirectory}models/`

/** file:// URI — for expo-file-system operations. */
export function modelFileUri(kind: ModelKind): string {
  return `${MODELS_DIR}${MODELS[kind].filename}`
}

/** Bare filesystem path (no file:// scheme) — what llama.rn's initLlama expects. */
export function modelLoadPath(kind: ModelKind): string {
  return modelFileUri(kind).replace('file://', '')
}

/** True only when the COMPLETE file is present (partials live under a .part name). */
export async function isModelDownloaded(kind: ModelKind): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(modelFileUri(kind))
  return info.exists && !info.isDirectory && (info.size ?? 0) > 0
}

// App readiness gates on the two REQUIRED models only — the embed model is
// optional (lexical fallback), so a missing or failed embed download never
// blocks journaling.
export async function areModelsReady(): Promise<boolean> {
  return (await isModelDownloaded('fast')) && (await isModelDownloaded('deep'))
}

/**
 * Best-effort, idempotent fetch of the optional embedding model. New users get
 * it during the onboarding download; this covers users already past onboarding
 * (fast+deep present, so the onboarding flow never re-runs). Safe to call often —
 * it no-ops once the file is present, and a failure is swallowed (embeddings
 * stay off until a later attempt succeeds).
 */
export async function ensureEmbedModel(): Promise<void> {
  if (await isModelDownloaded('embed')) return
  await downloadModel('embed') // Result, never throws — ignore failure
}

/**
 * Download one model into MODELS_DIR. Skips if it's already there (the explicit
 * check-before-download). Streams to a .part file and renames on completion, so
 * an interrupted download never looks "present" to isModelDownloaded.
 */
export async function downloadModel(
  kind: ModelKind,
  onProgress?: (fraction: number) => void
): Promise<Result<true>> {
  try {
    if (await isModelDownloaded(kind)) return ok(true)

    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true }).catch(() => undefined)
    const finalUri = modelFileUri(kind)
    const partUri = `${finalUri}.part`
    await FileSystem.deleteAsync(partUri, { idempotent: true }) // clear any stale partial

    const dl = FileSystem.createDownloadResumable(MODELS[kind].url, partUri, {}, (p) => {
      if (onProgress && p.totalBytesExpectedToWrite > 0) {
        onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite)
      }
    })
    const res = await dl.downloadAsync()
    if (!res) return err('MODEL_DOWNLOAD_FAILED', `Download interrupted for ${kind} model`)

    await FileSystem.moveAsync({ from: partUri, to: finalUri })
    return ok(true)
  } catch (e) {
    return err('MODEL_DOWNLOAD_FAILED', `Failed to download ${kind} model`, e)
  }
}
