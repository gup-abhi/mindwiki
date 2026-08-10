import * as FileSystem from 'expo-file-system'

import {
  BENCHMARK_MODELS,
  benchmarkModelFileUri,
  benchmarkModelPath,
  isBenchmarkModelPresent,
} from '@/services/llm/dev/benchmark-models'
import { MODELS, areModelsReady } from '@/services/llm/model-manager'

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(),
}))

const fs = FileSystem as jest.Mocked<typeof FileSystem>

beforeEach(() => jest.clearAllMocks())

describe('benchmark model descriptors', () => {
  it('keeps the candidate separate from the production deep model', () => {
    expect(BENCHMARK_MODELS.qwen2_5_3b.filename).toBe(MODELS.deep.filename)
    expect(BENCHMARK_MODELS.qwen3_4b.filename).not.toBe(MODELS.deep.filename)
    expect(benchmarkModelFileUri('qwen3_4b')).toBe('file:///docs/models/qwen3-4b-instruct-2507-benchmark.gguf')
    expect(benchmarkModelPath('qwen3_4b')).toBe('/docs/models/qwen3-4b-instruct-2507-benchmark.gguf')
    expect(MODELS.deep.url).toContain('Qwen2.5-3B-Instruct-GGUF')
  })

  it('accepts only a regular candidate file within its expected size range', async () => {
    fs.getInfoAsync.mockResolvedValueOnce({
      exists: true,
      isDirectory: false,
      size: BENCHMARK_MODELS.qwen3_4b.expectedMinBytes,
    } as never)
    expect(await isBenchmarkModelPresent('qwen3_4b')).toBe(true)

    fs.getInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: false, size: 1 } as never)
    expect(await isBenchmarkModelPresent('qwen3_4b')).toBe(false)
  })

  it('does not make the candidate part of production readiness', async () => {
    fs.getInfoAsync
      .mockResolvedValueOnce({ exists: true, isDirectory: false, size: 1 } as never)
      .mockResolvedValueOnce({ exists: true, isDirectory: false, size: 1 } as never)

    expect(await areModelsReady()).toBe(true)
    expect(fs.getInfoAsync).toHaveBeenCalledTimes(2)
  })
})
