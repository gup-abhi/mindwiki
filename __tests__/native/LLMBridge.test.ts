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

  it('throws a helpful error when the model fails to load', async () => {
    const initLlama = jest.fn().mockRejectedValue(new Error('file not found'))
    jest.doMock('llama.rn', () => ({ initLlama }))

    const { LLMBridge } = require('@/native/LLMBridge')
    await expect(LLMBridge.tag('x', { maxTokens: 10, temperature: 0.1 })).rejects.toThrow(
      /download the AI models in the app first/
    )
  })
})
