import { ModelBenchmarkBridge } from '@/native/ModelBenchmarkBridge'
import { runModelBenchmark } from '@/services/llm/dev/model-benchmark'

jest.mock('@/native/ModelBenchmarkBridge', () => ({
  ModelBenchmarkBridge: {
    loadModel: jest.fn(),
    complete: jest.fn(),
    releaseModel: jest.fn(),
  },
}))

const mockLoad = ModelBenchmarkBridge.loadModel as jest.Mock
const mockComplete = ModelBenchmarkBridge.complete as jest.Mock
const mockRelease = ModelBenchmarkBridge.releaseModel as jest.Mock

const extract = {
  emotion: 'Anxiety',
  distortion: 'Catastrophizing',
  distortion_confidence: 0.9,
  mood_score: 0.2,
  is_self_relevant: true,
  topics: ['Work'],
  people: ['Manager'],
  places: [],
  activities: ['Review meeting'],
  beliefs: ['I am incompetent'],
  behaviors: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLoad.mockResolvedValue({ loadMs: 100, cold: true })
  mockRelease.mockResolvedValue(undefined)
})

describe('runModelBenchmark', () => {
  it('aggregates synthetic jobs and releases the isolated model', async () => {
    mockComplete
      .mockResolvedValueOnce({ text: JSON.stringify(extract), durationMs: 20, tokensPredicted: 10, tokensPerSec: 10 })
      .mockResolvedValueOnce({ text: JSON.stringify({ ...extract, emotion: 'Joy', distortion: 'none', distortion_confidence: 0, mood_score: 0.9, topics: ['App'], people: [], activities: ['App'], beliefs: ['I can learn difficult things'], behaviors: ['Persistence'] }), durationMs: 30, tokensPredicted: 10, tokensPerSec: 11 })
      .mockResolvedValueOnce({ text: JSON.stringify({ ...extract, people: ['Sarah'], topics: ['Relationship'], activities: [], beliefs: ['People will leave me'], behaviors: ['Checking'], distortion: 'Mind reading' }), durationMs: 40, tokensPredicted: 10, tokensPerSec: 12 })
      .mockResolvedValueOnce({ text: 'You tend to brace for criticism before important meetings.', durationMs: 50, tokensPredicted: 10, tokensPerSec: 13 })
      .mockResolvedValueOnce({ text: 'You notice how a pause can make you look for signs of distance.', durationMs: 60, tokensPredicted: 10, tokensPerSec: 14 })
      .mockResolvedValueOnce({ text: 'That meeting is taking up a lot of space before it has even happened.', durationMs: 70, tokensPredicted: 10, tokensPerSec: 15 })
      .mockResolvedValueOnce({ text: 'That fear of being unwanted sounds painful to carry.', durationMs: 80, tokensPredicted: 10, tokensPerSec: 16 })

    const report = await runModelBenchmark('qwen3_4b')

    expect(report).toMatchObject({
      modelId: 'qwen3_4b',
      loadMs: 100,
      completed: 7,
      failures: 0,
      extractionValid: 3,
      extractionExact: 3,
      wikiStylePasses: 2,
      reflectStylePasses: 2,
      released: true,
      p50Ms: 50,
      p95Ms: 80,
      worstMs: 80,
    })
    expect(report.meanTokensPerSec).toBe(13)
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('continues after a failed fixture and never puts raw native details in its report', async () => {
    mockComplete
      .mockRejectedValueOnce(new Error('sensitive native output'))
      .mockResolvedValue({ text: '{}', durationMs: 20, tokensPredicted: 1, tokensPerSec: 5 })

    const report = await runModelBenchmark('qwen2_5_3b')

    expect(report.failures).toBe(1)
    expect(report.completed).toBe(6)
    expect(JSON.stringify(report)).not.toContain('sensitive native output')
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('adds representative soak completions to aggregate throughput and duration', async () => {
    mockComplete.mockResolvedValue({ text: '{}', durationMs: 25, tokensPredicted: 1, tokensPerSec: 4 })

    const report = await runModelBenchmark('qwen2_5_3b', { soakRuns: 3 })

    expect(report.completed).toBe(10)
    expect(mockComplete).toHaveBeenCalledTimes(10)
  })
})
