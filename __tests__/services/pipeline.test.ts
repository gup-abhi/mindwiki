import { processEntry } from '@/services/pipeline'
import { tagEntry } from '@/services/llm/fast-model'
import { applyTags, type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/fast-model', () => ({ tagEntry: jest.fn() }))
jest.mock('@/services/storage/entries', () => ({ applyTags: jest.fn() }))

const mockTagEntry = tagEntry as jest.Mock
const mockApplyTags = applyTags as jest.Mock

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: 0,
  mood: 3,
  situation: 'a calm afternoon',
  thought: 'things are okay',
  behavior: null,
  closing_note: null,
  emotion: null,
  distortion: null,
  mood_score: null,
  tagged_at: null,
  ...overrides,
})

describe('processEntry', () => {
  beforeEach(() => {
    mockTagEntry.mockReset()
    mockApplyTags.mockReset()
    mockApplyTags.mockResolvedValue(ok(undefined))
  })

  it('applies the model tags and assesses crisis from crisis_confidence', async () => {
    mockTagEntry.mockResolvedValue(
      ok({ emotion: 'anxiety', distortion: 'none', mood_score: 0.4, crisis_confidence: 0.65 })
    )

    const result = await processEntry(entry())

    expect(mockApplyTags).toHaveBeenCalledWith('e1', {
      emotion: 'anxiety',
      distortion: 'none',
      mood_score: 0.4,
    })
    expect(result.tagged).toBe(true)
    expect(result.crisis.tier).toBe(2) // 0.65 -> tier 2
  })

  it('still catches an explicit crisis via the keyword net when tagging fails', async () => {
    mockTagEntry.mockResolvedValue(err('TAG_INFERENCE_FAILED', 'model down'))

    const result = await processEntry(entry({ thought: 'I want to die' }))

    expect(result.tagged).toBe(false)
    expect(mockApplyTags).not.toHaveBeenCalled()
    expect(result.crisis.tier).toBe(3) // keyword safety net
  })

  it('reports tier 0 for a calm entry with low crisis confidence', async () => {
    mockTagEntry.mockResolvedValue(
      ok({ emotion: 'calm', distortion: 'none', mood_score: 0.8, crisis_confidence: 0.02 })
    )

    const result = await processEntry(entry())

    expect(result.crisis.tier).toBe(0)
    expect(result.tagged).toBe(true)
  })
})
