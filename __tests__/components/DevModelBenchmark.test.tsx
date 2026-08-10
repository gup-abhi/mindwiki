import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { DevModelBenchmark } from '@/components/DevModelBenchmark'
import { ModelBenchmarkBridge } from '@/native/ModelBenchmarkBridge'
import { isBenchmarkModelPresent } from '@/services/llm/dev/benchmark-models'
import { runModelBenchmark } from '@/services/llm/dev/model-benchmark'

jest.mock('@/native/ModelBenchmarkBridge', () => ({ ModelBenchmarkBridge: { releaseModel: jest.fn() } }))
jest.mock('@/services/llm/dev/benchmark-models', () => ({
  BENCHMARK_MODELS: {
    qwen2_5_3b: { label: 'Qwen2.5 3B Q4_K_M (current)' },
    qwen3_4b: { label: 'Qwen3 4B Instruct-2507 Q4_K_M' },
  },
  isBenchmarkModelPresent: jest.fn(),
}))
jest.mock('@/services/llm/dev/model-benchmark', () => ({ runModelBenchmark: jest.fn() }))

const mockPresent = isBenchmarkModelPresent as jest.Mock
const mockRun = runModelBenchmark as jest.Mock
const mockRelease = ModelBenchmarkBridge.releaseModel as jest.Mock

const report = {
  modelId: 'qwen3_4b' as const,
  loadMs: 100,
  completed: 7,
  failures: 0,
  extractionValid: 3,
  extractionExact: 3,
  wikiStylePasses: 2,
  reflectStylePasses: 2,
  thinkLeakCount: 0,
  durationsMs: [20],
  tokensPerSec: [10],
  p50Ms: 20,
  p95Ms: 20,
  worstMs: 20,
  meanTokensPerSec: 10,
  released: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPresent.mockResolvedValue(true)
  mockRun.mockResolvedValue(report)
  mockRelease.mockResolvedValue(undefined)
})

describe('DevModelBenchmark', () => {
  it('shows only aggregate local benchmark metrics', async () => {
    render(<DevModelBenchmark />)

    fireEvent.press(screen.getByTestId('dev-model-benchmark-candidate'))

    await waitFor(() => expect(screen.getByText(/Completed 7 · failures 0/)).toBeTruthy())
    expect(screen.getByText(/Extract valid 3 · exact 3 · wiki style 2 · Reflect style 2/)).toBeTruthy()
    expect(screen.queryByText(/fixture|native output/i)).toBeNull()
  })

  it('runs the soak with exactly 20 added jobs', async () => {
    render(<DevModelBenchmark />)

    fireEvent.press(screen.getByTestId('dev-model-benchmark-soak'))

    await waitFor(() => expect(mockRun).toHaveBeenCalledWith('qwen3_4b', { soakRuns: 20 }))
  })

  it('does not run when the selected candidate is unavailable', async () => {
    mockPresent.mockResolvedValue(false)
    render(<DevModelBenchmark />)

    fireEvent.press(screen.getByTestId('dev-model-benchmark-candidate'))

    await waitFor(() => expect(screen.getByText('Selected benchmark model is missing or has an unexpected size')).toBeTruthy())
    expect(mockRun).not.toHaveBeenCalled()
  })
})
