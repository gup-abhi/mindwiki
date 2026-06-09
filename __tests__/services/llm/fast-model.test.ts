import { tagEntry, normalizeEntities } from '@/services/llm/fast-model'
import { buildTagPrompt } from '@/services/llm/prompts/tag-entry'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('@/native/LLMBridge', () => ({ LLMBridge: { tag: jest.fn() } }))

const mockTag = LLMBridge.tag as jest.Mock

function modelReturns(text: string) {
  mockTag.mockResolvedValue({ text, tokensPredicted: 10, tokensPerSec: 40 })
}

describe('buildTagPrompt', () => {
  it('includes the situation and thought and asks for JSON only', () => {
    const p = buildTagPrompt({ situation: 'a meeting', thought: 'I will fail' })
    expect(p).toContain('a meeting')
    expect(p).toContain('I will fail')
    expect(p).toContain('ONLY a JSON object')
  })
})

describe('tagEntry', () => {
  beforeEach(() => mockTag.mockReset())

  it('returns the validated tag for well-formed JSON output', async () => {
    modelReturns(
      'Sure: {"emotion":"anxiety","distortion":"catastrophizing","mood_score":0.2,"crisis_confidence":0.1,"topic":"Work"} done'
    )
    const result = await tagEntry({ situation: 's', thought: 't' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.emotion).toBe('anxiety')
      expect(result.data.mood_score).toBe(0.2)
      expect(result.data.crisis_confidence).toBe(0.1)
      expect(result.data.topic).toBe('Work')
    }
  })

  it('fails with TAG_INFERENCE_FAILED when the model throws', async () => {
    mockTag.mockRejectedValue(new Error('OOM'))
    const result = await tagEntry({ situation: 's', thought: 't' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('TAG_INFERENCE_FAILED')
  })

  it('fails with TAG_PARSE_FAILED when there is no JSON', async () => {
    modelReturns('I cannot help with that.')
    const result = await tagEntry({ situation: 's', thought: 't' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('TAG_PARSE_FAILED')
  })

  it('fails with TAG_VALIDATION_FAILED when fields are wrong', async () => {
    modelReturns('{"emotion":"anxiety","distortion":"none","mood_score":"high"}')
    const result = await tagEntry({ situation: 's', thought: 't' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('TAG_VALIDATION_FAILED')
  })

  it('extracts + normalizes entity lists (and tolerates a missing list)', async () => {
    modelReturns(
      '{"emotion":"joy","distortion":"none","mood_score":0.8,"crisis_confidence":0.0,"topic":"Friends",' +
        '"people":["sarah"," sarah ","me","Bob"],"places":["the Office"]}'
    )
    const result = await tagEntry({ situation: 's', thought: 't' })
    expect(result.success).toBe(true)
    if (result.success) {
      // title-cased, de-duped (case-insensitive), self-reference dropped
      expect(result.data.people).toEqual(['Sarah', 'Bob'])
      expect(result.data.places).toEqual(['The Office'])
      expect(result.data.activities).toEqual([]) // missing list -> []
    }
  })
})

describe('normalizeEntities', () => {
  it('trims, title-cases, drops blanks/none/first-person, dedupes, caps at 3', () => {
    expect(
      normalizeEntities(['  alice ', 'Alice', 'none', 'I', 'bob', 'carol', 'dave'])
    ).toEqual(['Alice', 'Bob', 'Carol']) // 'alice' dup + 'none'/'I' dropped, capped at 3
  })
})
