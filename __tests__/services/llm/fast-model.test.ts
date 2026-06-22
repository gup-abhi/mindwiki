import { scoreCrisis } from '@/services/llm/fast-model'
import { buildCrisisPrompt } from '@/services/llm/prompts/crisis-signal'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('@/native/LLMBridge', () => ({ LLMBridge: { tag: jest.fn() } }))

const mockTag = LLMBridge.tag as jest.Mock

function modelReturns(text: string) {
  mockTag.mockResolvedValue({ text, tokensPredicted: 10, tokensPerSec: 40 })
}

describe('buildCrisisPrompt', () => {
  it('includes the entry and asks only for crisis_confidence JSON', () => {
    const p = buildCrisisPrompt({ situation: 'a meeting', thought: 'I will fail' })
    expect(p).toContain('a meeting')
    expect(p).toContain('crisis_confidence')
    expect(p).toContain('ONLY a JSON object')
    // the deep-model signals must NOT be on the fast path anymore
    expect(p).not.toMatch(/emotion|distortion|topic|activities/)
  })

  it('frames everyday distress as not-a-crisis to curb false positives', () => {
    const p = buildCrisisPrompt({ situation: 'a meeting', thought: 'I will fail' })
    // everyday anxiety/stress is explicitly normal and anchored near zero
    expect(p).toMatch(/anxiety/i)
    expect(p).toMatch(/not a crisis/i)
    expect(p).toMatch(/near 0\.0/)
    // must NOT seed a salient high target like 0.9 — the small model echoes it
    // (the "0.0 to 1.0" scale definition is fine; a 0.9-style anchor is not).
    expect(p).not.toContain('0.9')
  })
})

describe('scoreCrisis', () => {
  beforeEach(() => mockTag.mockReset())

  it('returns the validated crisis confidence', async () => {
    modelReturns('Sure: {"crisis_confidence":0.73} done')
    const result = await scoreCrisis({ situation: 's', thought: 't' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.crisis_confidence).toBe(0.73)
  })

  it('fails with CRISIS_INFERENCE_FAILED when the model throws', async () => {
    mockTag.mockRejectedValue(new Error('OOM'))
    const result = await scoreCrisis({ situation: 's', thought: 't' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('CRISIS_INFERENCE_FAILED')
  })

  it('fails with CRISIS_PARSE_FAILED when there is no JSON', async () => {
    modelReturns('I cannot help with that.')
    const result = await scoreCrisis({ situation: 's', thought: 't' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('CRISIS_PARSE_FAILED')
  })

  it('fails with CRISIS_VALIDATION_FAILED when the field is wrong', async () => {
    modelReturns('{"crisis_confidence":"high"}')
    const result = await scoreCrisis({ situation: 's', thought: 't' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('CRISIS_VALIDATION_FAILED')
  })
})
