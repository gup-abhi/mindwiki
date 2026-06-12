import { tagEntry, normalizeEntities } from '@/services/llm/fast-model'
import { buildTagPrompt } from '@/services/llm/prompts/tag-entry'
import { canonicalizeEmotion, canonicalizeDistortion } from '@/services/llm/taxonomy'
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

  it('asks for the working_on pursuit field', () => {
    const p = buildTagPrompt({ situation: 's', thought: 't' })
    expect(p).toContain('working_on')
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
      // snapped to the controlled vocabulary (Title Case)
      expect(result.data.emotion).toBe('Anxiety')
      expect(result.data.distortion).toBe('Catastrophizing')
      expect(result.data.mood_score).toBe(0.2)
      expect(result.data.crisis_confidence).toBe(0.1)
      expect(result.data.topic).toBe('Work')
      expect(result.data.working_on).toBe('') // defaults when the model omits it
    }
  })

  it('passes through the working_on phrase when present', async () => {
    modelReturns(
      '{"emotion":"hope","distortion":"none","mood_score":0.7,"crisis_confidence":0.0,"topic":"Fitness","working_on":"Marathon training"}'
    )
    const result = await tagEntry({ situation: 's', thought: 't' })
    expect(result.success && result.data.working_on).toBe('Marathon training')
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

describe('controlled vocabulary', () => {
  it('snaps emotion synonyms/variants to a single canonical term', () => {
    expect(canonicalizeEmotion('anxious')).toBe('Anxiety') // alias
    expect(canonicalizeEmotion('nervous')).toBe('Anxiety') // alias
    expect(canonicalizeEmotion('ANXIETY')).toBe('Anxiety') // exact, case-insensitive
    expect(canonicalizeEmotion('saddness')).toBe('Sadness') // fuzzy (typo) -> nearest
  })

  it('snaps distortions and resolves unknowns to none', () => {
    expect(canonicalizeDistortion('catastrophising')).toBe('Catastrophizing') // alias spelling
    expect(canonicalizeDistortion('mind-reading')).toBe('Mind reading') // alias
    expect(canonicalizeDistortion('none')).toBe('none')
    expect(canonicalizeDistortion('totally unrelated phrase')).toBe('none') // unknown -> none
  })
})
