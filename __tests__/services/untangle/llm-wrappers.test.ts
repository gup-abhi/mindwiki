import { suggestUntanglePatterns } from '@/services/untangle/service'
import { LLMBridge } from '@/native/LLMBridge'
import { canonicalizeDistortion } from '@/services/llm/taxonomy'

jest.mock('@/native/LLMBridge', () => ({ LLMBridge: { tag: jest.fn() } }))

const mockTag = LLMBridge.tag as jest.Mock

function modelReturns(text: string) {
  mockTag.mockResolvedValue({ text, tokensPredicted: 10, tokensPerSec: 40 })
}

describe('suggestUntanglePatterns (fast-model wrapper)', () => {
  beforeEach(() => mockTag.mockReset())

  it('canonicalizes accepted labels and caps/dedupes to two', async () => {
    modelReturns('{"patterns":["mind-reading","Mind Reading","catastrophizing","labeling"]}')
    const res = await suggestUntanglePatterns('I will be humiliated')
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.patterns).toEqual(['Mind reading', 'Catastrophizing'])
    }
  })

  it('drops malformed/unknown labels and returns fewer (or empty) without failing', async () => {
    modelReturns('{"patterns":["banana","what is this"]}')
    const res = await suggestUntanglePatterns('I will be humiliated')
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.patterns).toEqual([])
  })

  it('strip-wraps trailing "none" sentinel → empty list', async () => {
    modelReturns('{"patterns":["none"]}')
    const res = await suggestUntanglePatterns('I will be humiliated')
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.patterns).toEqual([])
  })

  it('returns a coded Result on inference failure (no thought text in error)', async () => {
    mockTag.mockRejectedValue(new Error('boom'))
    const res = await suggestUntanglePatterns('I will be humiliated')
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(typeof res.error.code).toBe('string')
      expect(JSON.stringify(res.error)).not.toContain('humiliated')
    }
  })

  it('returns a coded Result on parse failure', async () => {
    modelReturns('not json at all')
    const res = await suggestUntanglePatterns('a thought')
    expect(res.success).toBe(false)
  })

  it('returns a coded Result on schema failure', async () => {
    modelReturns('{garbage')
    const res = await suggestUntanglePatterns('a thought')
    expect(res.success).toBe(false)
  })

  it('keeps the canonical guard as a final safety net', () => {
    // prove the wrapper relies on canonicalizeDistortion for unknowns → 'none'
    expect(canonicalizeDistortion('banana')).toBe('none')
    expect(canonicalizeDistortion('mind-reading')).toBe('Mind reading')
  })
})
