import { assessMessageCrisis } from '@/services/crisis/message'
import { tagEntry } from '@/services/llm/fast-model'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/fast-model', () => ({ tagEntry: jest.fn() }))
const mockTag = tagEntry as jest.Mock

const tag = (crisis_confidence: number) =>
  ok({
    emotion: 'Sadness',
    distortion: 'none',
    mood_score: 0.2,
    crisis_confidence,
    topic: 'x',
    people: [],
    places: [],
    activities: [],
  })

describe('assessMessageCrisis', () => {
  beforeEach(() => mockTag.mockReset())

  it('forces tier 3 on an explicit keyword even when the model fails', async () => {
    mockTag.mockResolvedValue(err('TAG_INFERENCE_FAILED', 'no model'))
    const res = await assessMessageCrisis('I want to die')
    expect(res.tier).toBe(3)
    expect(res.keywordMatch).toBe(true)
  })

  it('folds in the model confidence when tagging succeeds', async () => {
    mockTag.mockResolvedValue(tag(0.7))
    const res = await assessMessageCrisis('everything feels pointless')
    expect(res.tier).toBe(2) // 0.6 ≤ 0.7 < 0.85
    expect(res.confidence).toBe(0.7)
  })

  it('returns tier 0 for an ordinary message', async () => {
    mockTag.mockResolvedValue(tag(0.05))
    const res = await assessMessageCrisis('had a nice walk today')
    expect(res.tier).toBe(0)
  })
})
