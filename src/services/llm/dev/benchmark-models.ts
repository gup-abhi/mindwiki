import * as FileSystem from 'expo-file-system'

import { MODELS_DIR } from '@/services/llm/model-manager'

export type BenchmarkModelId = 'qwen2_5_3b' | 'qwen3_4b'

export interface BenchmarkModel {
  id: BenchmarkModelId
  label: string
  filename: string
  expectedMinBytes: number
  expectedMaxBytes: number
  template: 'qwen2_5_chatml' | 'qwen3_chatml'
}

/**
 * Developer-only A/B candidates. These are intentionally separate from MODELS:
 * normal readiness, onboarding, downloads, and production LLMBridge selection
 * must remain bound to the shipped Qwen2.5 deep model.
 */
export const BENCHMARK_MODELS: Record<BenchmarkModelId, BenchmarkModel> = {
  qwen2_5_3b: {
    id: 'qwen2_5_3b',
    label: 'Qwen2.5 3B Q4_K_M (current)',
    filename: 'deep-model.gguf',
    expectedMinBytes: 1_500_000_000,
    expectedMaxBytes: 2_300_000_000,
    template: 'qwen2_5_chatml',
  },
  qwen3_4b: {
    id: 'qwen3_4b',
    label: 'Qwen3 4B Instruct-2507 Q4_K_M',
    filename: 'qwen3-4b-instruct-2507-benchmark.gguf',
    expectedMinBytes: 2_000_000_000,
    expectedMaxBytes: 3_100_000_000,
    template: 'qwen3_chatml',
  },
}

export function benchmarkModelFileUri(id: BenchmarkModelId): string {
  return `${MODELS_DIR}${BENCHMARK_MODELS[id].filename}`
}

export function benchmarkModelPath(id: BenchmarkModelId): string {
  return benchmarkModelFileUri(id).replace('file://', '')
}

/** Only a size sanity check. Host-side SHA-256 verification remains authoritative. */
export async function isBenchmarkModelPresent(id: BenchmarkModelId): Promise<boolean> {
  const spec = BENCHMARK_MODELS[id]
  const info = await FileSystem.getInfoAsync(benchmarkModelFileUri(id))
  const size = info.exists && !info.isDirectory ? info.size ?? 0 : 0
  return info.exists && !info.isDirectory && size >= spec.expectedMinBytes && size <= spec.expectedMaxBytes
}
