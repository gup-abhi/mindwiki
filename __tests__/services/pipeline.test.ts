import { processEntry } from '@/services/pipeline'
import { tagEntry } from '@/services/llm/fast-model'
import { applyTags, type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/fast-model', () => ({ tagEntry: jest.fn() }))
jest.mock('@/services/storage/entries', () => ({ applyTags: jest.fn() }))
jest.mock('@/services/wiki/engine', () => ({ updateWikiForEntry: jest.fn() }))
jest.mock('@/services/graph/engine', () => ({ updateGraphForEntry: jest.fn() }))

const mockBegin = jest.fn()
const mockEnd = jest.fn()
jest.mock('@/store/wiki.store', () => ({
  useWikiStore: { getState: () => ({ begin: mockBegin, end: mockEnd }) },
}))

import { updateWikiForEntry } from '@/services/wiki/engine'
import { updateGraphForEntry } from '@/services/graph/engine'

const mockTagEntry = tagEntry as jest.Mock
const mockApplyTags = applyTags as jest.Mock
const mockUpdateWiki = updateWikiForEntry as jest.Mock
const mockUpdateGraph = updateGraphForEntry as jest.Mock

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
    mockUpdateWiki.mockReset()
    mockUpdateGraph.mockReset()
    mockBegin.mockReset()
    mockEnd.mockReset()
    mockApplyTags.mockResolvedValue(ok(undefined))
    mockUpdateWiki.mockResolvedValue(ok([]))
    mockUpdateGraph.mockResolvedValue(ok(undefined))
  })

  it('applies the model tags and assesses crisis from crisis_confidence', async () => {
    mockTagEntry.mockResolvedValue(
      ok({
        emotion: 'anxiety',
        distortion: 'none',
        mood_score: 0.4,
        crisis_confidence: 0.65,
        topic: 'Work',
      })
    )

    const result = await processEntry(entry())

    expect(mockApplyTags).toHaveBeenCalledWith('e1', {
      emotion: 'anxiety',
      distortion: 'none',
      mood_score: 0.4,
    })
    expect(result.tagged).toBe(true)
    expect(result.crisis.tier).toBe(2) // 0.65 -> tier 2
    // wiki synthesis kicked off in the background with the tagged entry + topic
    expect(mockUpdateWiki).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', emotion: 'anxiety', distortion: 'none' }),
      'Work'
    )
    // graph update also kicked off with the tagged entry + topic
    expect(mockUpdateGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', emotion: 'anxiety' }),
      'Work'
    )
    // synthesis status begins, and ends once the background update settles
    expect(mockBegin).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it('still catches an explicit crisis via the keyword net when tagging fails', async () => {
    mockTagEntry.mockResolvedValue(err('TAG_INFERENCE_FAILED', 'model down'))

    const result = await processEntry(entry({ thought: 'I want to die' }))

    expect(result.tagged).toBe(false)
    expect(mockApplyTags).not.toHaveBeenCalled()
    expect(mockUpdateWiki).not.toHaveBeenCalled() // no tags -> no wiki update
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
