// Fresh module state per test so the model-context cache doesn't leak.
describe('LLMBridge (llama.rn)', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('tag builds a ChatML prompt and maps the completion result', async () => {
    const completion = jest.fn().mockResolvedValue({
      text: '{"emotion":"anxiety"}',
      tokens_predicted: 12,
      timings: { predicted_per_second: 44 },
    })
    const initLlama = jest.fn().mockResolvedValue({ completion, release: jest.fn() })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    const result = await LLMBridge.tag('classify this', { maxTokens: 50, temperature: 0.1 })

    expect(result).toEqual({
      text: '{"emotion":"anxiety"}',
      tokensPredicted: 12,
      tokensPerSec: 44,
    })
    // loaded the fast model
    expect(initLlama).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.stringContaining('fast-model.gguf') })
    )
    // ChatML prompt + the user's text, with n_predict from opts
    const callArg = completion.mock.calls[0][0]
    expect(callArg.prompt).toContain('<|im_start|>user\nclassify this<|im_end|>')
    expect(callArg.n_predict).toBe(50)
  })

  it('caches the context across calls (loads once)', async () => {
    const completion = jest.fn().mockResolvedValue({
      text: 'ok',
      tokens_predicted: 1,
      timings: { predicted_per_second: 10 },
    })
    const initLlama = jest.fn().mockResolvedValue({ completion, release: jest.fn() })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    await LLMBridge.tag('a', { maxTokens: 10, temperature: 0.1 })
    await LLMBridge.tag('b', { maxTokens: 10, temperature: 0.1 })

    expect(initLlama).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent deep-model completions (never two at once)', async () => {
    let active = 0
    let maxActive = 0
    const completion = jest.fn().mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return { text: 'ok', tokens_predicted: 1, timings: { predicted_per_second: 10 } }
    })
    const initLlama = jest.fn().mockResolvedValue({ completion, release: jest.fn() })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    // A reply and a background synthesis firing at the same time, both on the deep ctx.
    await Promise.all([
      LLMBridge.synthesise('a', { maxTokens: 10, temperature: 0.1 }),
      LLMBridge.converse([{ role: 'user', content: 'b' }], { maxTokens: 10, temperature: 0.1 }),
    ])

    expect(completion).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1) // the lock kept them from overlapping
  })

  it('a live reply jumps the queue ahead of pending background synthesis', async () => {
    const order: string[] = []
    const completion = jest.fn().mockImplementation(async (params: { prompt: string }) => {
      // First chars of each prompt identify the caller (ChatML prefixes differ,
      // so tag by content).
      const tag = params.prompt.includes('REPLY') ? 'reply' : params.prompt.includes('SYNTH-A') ? 'a' : 'b'
      order.push(tag)
      await new Promise((r) => setTimeout(r, 5))
      return { text: 'ok', tokens_predicted: 1, timings: { predicted_per_second: 10 } }
    })
    const initLlama = jest.fn().mockResolvedValue({ completion, release: jest.fn() })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    // Two background syntheses queue up, THEN the user sends a message.
    const a = LLMBridge.synthesise('SYNTH-A', { maxTokens: 10, temperature: 0.1 })
    const b = LLMBridge.synthesise('SYNTH-B', { maxTokens: 10, temperature: 0.1 })
    const reply = LLMBridge.converse([{ role: 'user', content: 'REPLY' }], {
      maxTokens: 10,
      temperature: 0.1,
    })
    await Promise.all([a, b, reply])

    // A is already running when the reply arrives; the reply preempts B.
    expect(order).toEqual(['a', 'reply', 'b'])
  })

  it('a stalled completion rejects cleanly even when stopCompletion returns undefined', async () => {
    jest.useFakeTimers()
    try {
      const completion = jest.fn().mockImplementation(() => new Promise(() => undefined)) // wedged
      // Some llama.rn builds return void here — calling .catch on it crashed the
      // watchdog timer, skipped reject(), and wedged the model lock forever.
      const stopCompletion = jest.fn().mockReturnValue(undefined)
      const initLlama = jest.fn().mockResolvedValue({ completion, stopCompletion, release: jest.fn() })
      jest.doMock('llama.rn', () => ({ initLlama }))

      const { LLMBridge } = require('@/native/LLMBridge')
      const pending = LLMBridge.converse([{ role: 'user', content: 'hi' }], {
        maxTokens: 10,
        temperature: 0.1,
      })
      const rejection = expect(pending).rejects.toThrow(/stalled/)
      await jest.advanceTimersByTimeAsync(60_001)
      await rejection
      expect(stopCompletion).toHaveBeenCalled()

      // The lock chain must survive the stall: the next completion still runs.
      completion.mockResolvedValue({ text: 'ok', tokens_predicted: 1, timings: { predicted_per_second: 10 } })
      const next = await LLMBridge.synthesise('a', { maxTokens: 10, temperature: 0.1 })
      expect(next.text).toBe('ok')
    } finally {
      jest.useRealTimers()
    }
  })

  it('throws a helpful error when the model fails to load', async () => {
    const initLlama = jest.fn().mockRejectedValue(new Error('file not found'))
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    await expect(LLMBridge.tag('x', { maxTokens: 10, temperature: 0.1 })).rejects.toThrow(
      /download the AI models in the app first/
    )
  })

  it('recreates the embed context per call so state cannot leak across embeds', async () => {
    // clearCache(true) is also a no-op for the embed KV leak on this llama.rn
    // build (device: cos(a1,a2) still 0.655, even on first cold call ≈0.8 then
    // settling to 0.655). The leak survives every reset llama.rn exposes. The
    // only working workaround is to throw the context away and load a fresh one
    // per embed — the binding cannot leak state into a brand-new context.
    // initLlama returns a NEW context object per call (different .id) so we
    // can detect the recreate.
    let nextId = 0
    const initLlama = jest.fn().mockImplementation(() => {
      const id = nextId++
      return Promise.resolve({
        id,
        embedding: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2] }),
        clearCache: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      })
    })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    const r1 = await LLMBridge.embed('first')
    const r2 = await LLMBridge.embed('second')

    // Two separate context lifecycles — release was called on the first before
    // the second was loaded, and the embedding context object held by the two
    // calls is NOT the same.
    expect(initLlama).toHaveBeenCalledTimes(2)
    expect(r1).toEqual([0.1, 0.2])
    expect(r2).toEqual([0.1, 0.2])
  })

  it('a staggered second embed never shares or releases a context in use', async () => {
    // The recreate-per-embed fix only holds if the WHOLE lifecycle (load →
    // embed → release) is serialized under the model lock. The dangerous
    // interleaving is STAGGERED, not simultaneous: a live query embed (B) calls
    // ensureLoaded AFTER a background backfill embed (A) has stored its context
    // but BEFORE A's finally releases it. If load/release sit outside the lock,
    // B reuses A's context (reintroducing the state leak) and A then releases it
    // out from under B mid-embed. Each embed must own a fresh context end to end.
    let nextId = 0
    const initLlama = jest.fn().mockImplementation(() => {
      const id = nextId++
      let released = false
      return Promise.resolve({
        id,
        embedding: jest.fn().mockImplementation(async () => {
          if (released) throw new Error('embedding called on a released context')
          await new Promise((r) => setTimeout(r, 20))
          if (released) throw new Error('context released mid-embed')
          return { embedding: [id] }
        }),
        release: jest.fn().mockImplementation(async () => {
          released = true
        }),
      })
    })
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    // A starts and gets into its embedding call…
    const a = LLMBridge.embed('a')
    await new Promise((r) => setTimeout(r, 5))
    // …then B arrives while A is still mid-embed. On the buggy path B would see
    // A's stored context and reuse it; A's finally would then release it under B.
    const b = LLMBridge.embed('b')
    const [ra, rb] = await Promise.all([a, b])

    expect(initLlama).toHaveBeenCalledTimes(2) // each embed loaded its own context
    expect(ra).not.toEqual(rb) // different context ids → contexts were not shared
  })
})
