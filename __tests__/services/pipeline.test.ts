import { processEntry, captureReflectMessage } from '@/services/pipeline'
import { tagEntry } from '@/services/llm/fast-model'
import { applyTags, createEntry, type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/fast-model', () => ({ tagEntry: jest.fn() }))
jest.mock('@/services/storage/entries', () => ({ applyTags: jest.fn(), createEntry: jest.fn() }))
jest.mock('@/services/storage/entities', () => ({ setEntitiesForEntry: jest.fn() }))
jest.mock('@/services/wiki/engine', () => ({ updateWikiForEntry: jest.fn() }))
jest.mock('@/services/graph/engine', () => ({ updateGraphForEntry: jest.fn() }))
jest.mock('@/services/storage/settings', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }))

const mockBegin = jest.fn()
const mockEnd = jest.fn()
jest.mock('@/store/wiki.store', () => ({
  useWikiStore: { getState: () => ({ begin: mockBegin, end: mockEnd }) },
}))

import { updateWikiForEntry } from '@/services/wiki/engine'
import { updateGraphForEntry } from '@/services/graph/engine'
import { setEntitiesForEntry } from '@/services/storage/entities'
import { getSetting, setSetting } from '@/services/storage/settings'

const mockTagEntry = tagEntry as jest.Mock
const mockApplyTags = applyTags as jest.Mock
const mockCreateEntry = createEntry as jest.Mock
const mockUpdateWiki = updateWikiForEntry as jest.Mock
const mockUpdateGraph = updateGraphForEntry as jest.Mock
const mockSetEntities = setEntitiesForEntry as jest.Mock
const mockGetSetting = getSetting as jest.Mock
const mockSetSetting = setSetting as jest.Mock

// Tag output always carries the three entity lists (normalized in fast-model).
const tags = (over: Record<string, unknown> = {}) => ({
  emotion: 'anxiety',
  distortion: 'none',
  mood_score: 0.4,
  crisis_confidence: 0.65,
  topic: 'Work',
  people: [],
  places: [],
  activities: [],
  ...over,
})

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
  topic: null,
  tagged_at: null,
  source: 'journal',
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
    mockSetEntities.mockReset()
    mockSetEntities.mockResolvedValue(ok(undefined))
  })

  it('applies the model tags and assesses crisis from crisis_confidence', async () => {
    mockTagEntry.mockResolvedValue(ok(tags({ people: ['Sarah'], places: ['Office'] })))

    const result = await processEntry(entry())

    // extracted entities are persisted (people + places mapped to typed rows)
    expect(mockSetEntities).toHaveBeenCalledWith('e1', [
      { type: 'person', label: 'Sarah' },
      { type: 'place', label: 'Office' },
    ])

    expect(mockApplyTags).toHaveBeenCalledWith('e1', {
      emotion: 'anxiety',
      distortion: 'none',
      mood_score: 0.4,
      topic: 'Work',
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
      ok(tags({ emotion: 'calm', mood_score: 0.8, crisis_confidence: 0.02 }))
    )

    const result = await processEntry(entry())

    expect(result.crisis.tier).toBe(0)
    expect(result.tagged).toBe(true)
  })
})

describe('captureReflectMessage', () => {
  beforeEach(() => {
    mockTagEntry.mockReset()
    mockApplyTags.mockReset()
    mockCreateEntry.mockReset()
    mockSetEntities.mockReset()
    mockUpdateWiki.mockReset()
    mockUpdateGraph.mockReset()
    mockBegin.mockReset()
    mockEnd.mockReset()
    mockGetSetting.mockReset()
    mockSetSetting.mockReset()
    mockApplyTags.mockResolvedValue(ok(undefined))
    mockSetEntities.mockResolvedValue(ok(undefined))
    mockUpdateWiki.mockResolvedValue(ok([]))
    mockUpdateGraph.mockResolvedValue(ok(undefined))
    mockCreateEntry.mockResolvedValue(ok(entry({ id: 'r1', source: 'reflect' })))
    mockGetSetting.mockResolvedValue({ success: true, data: null }) // theme unseen
    mockSetSetting.mockResolvedValue({ success: true, data: undefined })
  })

  it('never ingests a question (no tagging, no capture)', async () => {
    await captureReflectMessage('What tends to trigger my Sadness?')

    expect(mockTagEntry).not.toHaveBeenCalled()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('skips the FIRST mention of a theme but records it', async () => {
    mockTagEntry.mockResolvedValue(ok(tags({ topic: 'Boundaries' })))

    await captureReflectMessage('I think I need firmer boundaries')

    // counted (now seen once) but not yet ingested
    expect(mockSetSetting).toHaveBeenCalledWith('reflect:theme:boundaries', '1')
    expect(mockCreateEntry).not.toHaveBeenCalled()
    expect(mockUpdateWiki).not.toHaveBeenCalled()
  })

  it('captures a theme once it recurs (second mention)', async () => {
    mockGetSetting.mockResolvedValue({ success: true, data: '1' }) // seen once before
    mockTagEntry.mockResolvedValue(ok(tags({ topic: 'Boundaries' })))

    await captureReflectMessage('I really do need firmer boundaries with work')

    expect(mockSetSetting).toHaveBeenCalledWith('reflect:theme:boundaries', '2')
    expect(mockCreateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'reflect' })
    )
    expect(mockUpdateWiki).toHaveBeenCalled()
  })

  it('skips a statement with no real theme', async () => {
    mockTagEntry.mockResolvedValue(ok(tags({ topic: 'none' })))

    await captureReflectMessage('thanks, that helps')

    expect(mockSetSetting).not.toHaveBeenCalled()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('does nothing when tagging fails (never throws)', async () => {
    mockTagEntry.mockResolvedValue(err('TAG_INFERENCE_FAILED', 'model down'))

    await expect(captureReflectMessage('I felt calm at the park')).resolves.toBeUndefined()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })
})
