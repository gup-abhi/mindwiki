import { suggestUntangleReframes } from '@/services/untangle/service'
import { LLMBridge } from '@/native/LLMBridge'
import { type UntangleReframeInput } from '@/services/untangle/service'

jest.mock('@/native/LLMBridge', () => ({ LLMBridge: { synthesise: jest.fn() } }))

const mockSynth = LLMBridge.synthesise as jest.Mock

function synthReturns(text: string) {
  mockSynth.mockResolvedValue({ text, tokensPredicted: 30, tokensPerSec: 40 })
}

const INPUT: UntangleReframeInput = {
  thought: 'I will be humiliated at the meeting',
  patterns: ['Mind reading', 'Catastrophizing'],
  sources: [{ title: 'Work', excerpt: 'You often feel anxious before presentations at work.' }],
}

describe('suggestUntangleReframes (deep-model wrapper)', () => {
  beforeEach(() => mockSynth.mockReset())

  it('accepts exactly three valid styles held by the schema', async () => {
    synthReturns(
      'factual: I do not know what others think.\ngentle: It is okay to feel nervous.\naction: I can prepare one thing.'
    )
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.factual).toMatch(/do not know what others think/i)
      expect(res.data.gentle).toMatch(/okay to feel nervous/i)
      expect(res.data.action).toMatch(/prepare one thing/i)
    }
  })

  it('accepts numbered markdown labels from small-model output', async () => {
    synthReturns(
      '1. **factual** — I do not know what others think.\n2. **gentle**: It is okay to feel nervous.\n3. **action** - I can prepare one thing.'
    )
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.factual).toMatch(/do not know what others think/i)
      expect(res.data.gentle).toMatch(/okay to feel nervous/i)
      expect(res.data.action).toMatch(/prepare one thing/i)
    }
  })

  it('accepts a valid JSON candidate object', async () => {
    synthReturns(JSON.stringify({
      factual: 'I do not know what others think.',
      gentle: 'It is okay to feel nervous.',
      action: 'I can prepare one thing.',
    }))
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(true)
  })

  it('accepts section headings followed by candidates on the next line', async () => {
    synthReturns(
      '**Factual alternative**\nI do not know what others think.\n\n**Gentle view**\nIt is okay to feel nervous.\n\n**Action-oriented step**\nI can prepare one thing.'
    )
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.factual).toMatch(/do not know what others think/i)
      expect(res.data.gentle).toMatch(/okay to feel nervous/i)
      expect(res.data.action).toMatch(/prepare one thing/i)
    }
  })

  it('accepts compassionate and practical heading aliases', async () => {
    synthReturns(
      '**Factual**\nI do not know what others think.\n**Compassionate alternative**\nIt is okay to feel nervous.\n**Practical next step**\nI can prepare one thing.'
    )
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.gentle).toMatch(/okay to feel nervous/i)
      expect(res.data.action).toMatch(/prepare one thing/i)
    }
  })

  it('strips wrapping quotes from each line', async () => {
    synthReturns(
      'factual: "I do not know."\ngentle: \'It is okay.\'\naction: "I can prepare."'
    )
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.factual).not.toMatch(/^["']|["']$/)
      expect(res.data.gentle).not.toMatch(/^["']|["']$/)
      expect(res.data.action).not.toMatch(/^["']|["']$/)
    }
  })

  it('rejects missing / overlong / duplicate candidates with a coded Result', async () => {
    synthReturns('factual: only one\nwhy not no label here')
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(false)
    if (!res.success) expect(typeof res.error.code).toBe('string')
  })

  it('rejects ellipsis placeholders echoed from an output scaffold', async () => {
    synthReturns('factual: ...\ngentle: ...\naction: ...')
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('REFRAME_VALIDATION_FAILED')
  })

  it('rejects duplicate alternatives', async () => {
    synthReturns('factual: same\ngentle: same\naction: different')
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(false)
  })

  it('rejects overlong alternatives', async () => {
    const long = 'x'.repeat(250)
    synthReturns(`factual: ${long}\ngentle: b\naction: c`)
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(false)
  })

  it('maps inference failure to coded Result (no thought text)', async () => {
    mockSynth.mockRejectedValue(new Error('boom'))
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(typeof res.error.code).toBe('string')
      expect(JSON.stringify(res.error)).not.toContain('humiliated')
    }
  })

  it('maps parse failure to coded Result', async () => {
    synthReturns('totally non-json-unstructured prose without labels')
    const res = await suggestUntangleReframes(INPUT)
    expect(res.success).toBe(false)
  })
})
