describe('ModelBenchmarkBridge', () => {
  beforeEach(() => jest.resetModules())

  function nativeResult(text = 'ok') {
    return {
      text,
      tokens_predicted: 8,
      timings: { predicted_per_second: 12 },
    }
  }

  it('loads the candidate at its dedicated path with the fixed CPU profile', async () => {
    const completion = jest.fn().mockResolvedValue(nativeResult())
    const release = jest.fn().mockResolvedValue(undefined)
    const initLlama = jest.fn().mockResolvedValue({ completion, release, stopCompletion: jest.fn() })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { ModelBenchmarkBridge } = require('@/native/ModelBenchmarkBridge')
    await ModelBenchmarkBridge.loadModel('qwen3_4b')
    await ModelBenchmarkBridge.complete('qwen3_4b', { kind: 'single_turn', content: 'fixture' }, { maxTokens: 20, temperature: 0 })

    expect(initLlama).toHaveBeenCalledWith({
      model: expect.stringContaining('qwen3-4b-instruct-2507-benchmark.gguf'),
      n_ctx: 2048,
      n_threads: 6,
      n_threads_batch: 6,
    })
    expect(completion.mock.calls[0][0].prompt).toContain('<|im_start|>user\nfixture<|im_end|>')
    expect(completion.mock.calls[0][0].stop).toEqual(['<|im_end|>', '<|endoftext|>'])
  })

  it('releases one model before loading the next', async () => {
    const releaseA = jest.fn().mockResolvedValue(undefined)
    const releaseB = jest.fn().mockResolvedValue(undefined)
    const initLlama = jest.fn()
      .mockResolvedValueOnce({ completion: jest.fn().mockResolvedValue(nativeResult()), release: releaseA, stopCompletion: jest.fn() })
      .mockResolvedValueOnce({ completion: jest.fn().mockResolvedValue(nativeResult()), release: releaseB, stopCompletion: jest.fn() })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { ModelBenchmarkBridge } = require('@/native/ModelBenchmarkBridge')
    await ModelBenchmarkBridge.loadModel('qwen2_5_3b')
    await ModelBenchmarkBridge.loadModel('qwen3_4b')

    expect(releaseA).toHaveBeenCalledTimes(1)
    expect(initLlama.mock.calls[0][0].model).toContain('deep-model.gguf')
    expect(initLlama.mock.calls[1][0].model).toContain('qwen3-4b-instruct-2507-benchmark.gguf')
  })

  it('serializes concurrent completions', async () => {
    let active = 0
    let maxActive = 0
    const completion = jest.fn().mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return nativeResult()
    })
    jest.doMock('llama.rn', () => ({
      initLlama: jest.fn().mockResolvedValue({ completion, release: jest.fn(), stopCompletion: jest.fn() }),
    }))

    const { ModelBenchmarkBridge } = require('@/native/ModelBenchmarkBridge')
    await ModelBenchmarkBridge.loadModel('qwen3_4b')
    await Promise.all([
      ModelBenchmarkBridge.complete('qwen3_4b', { kind: 'single_turn', content: 'a' }, { maxTokens: 20, temperature: 0 }),
      ModelBenchmarkBridge.complete('qwen3_4b', { kind: 'single_turn', content: 'b' }, { maxTokens: 20, temperature: 0 }),
    ])

    expect(maxActive).toBe(1)
  })

  it('uses explicit conversation turns without touching production LLMBridge', async () => {
    const completion = jest.fn().mockResolvedValue(nativeResult())
    jest.doMock('llama.rn', () => ({
      initLlama: jest.fn().mockResolvedValue({ completion, release: jest.fn(), stopCompletion: jest.fn() }),
    }))

    const { ModelBenchmarkBridge } = require('@/native/ModelBenchmarkBridge')
    await ModelBenchmarkBridge.loadModel('qwen2_5_3b')
    await ModelBenchmarkBridge.complete('qwen2_5_3b', {
      kind: 'conversation',
      messages: [{ role: 'system', content: 'System rule' }, { role: 'user', content: 'Fixture' }],
    }, { maxTokens: 20, temperature: 0 })

    expect(completion.mock.calls[0][0].prompt).toBe(
      '<|im_start|>system\nSystem rule<|im_end|>\n<|im_start|>user\nFixture<|im_end|>\n<|im_start|>assistant\n'
    )
  })

  it('releases its context after a completion failure', async () => {
    const release = jest.fn().mockResolvedValue(undefined)
    const completion = jest.fn().mockRejectedValue(new Error('native detail'))
    jest.doMock('llama.rn', () => ({
      initLlama: jest.fn().mockResolvedValue({ completion, release, stopCompletion: jest.fn() }),
    }))

    const { ModelBenchmarkBridge } = require('@/native/ModelBenchmarkBridge')
    await ModelBenchmarkBridge.loadModel('qwen3_4b')
    await expect(
      ModelBenchmarkBridge.complete('qwen3_4b', { kind: 'single_turn', content: 'fixture' }, { maxTokens: 20, temperature: 0 })
    ).rejects.toThrow('BENCHMARK_COMPLETION_FAILED')
    await ModelBenchmarkBridge.releaseModel()

    expect(release).toHaveBeenCalledTimes(1)
  })
})
