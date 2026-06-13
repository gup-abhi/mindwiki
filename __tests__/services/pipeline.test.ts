import { processEntry, captureReflectMessage } from '@/services/pipeline'
import { tagEntry } from '@/services/llm/fast-model'
import { applyTags, createEntry, type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/fast-model', () => ({ tagEntry: jest.fn() }))
jest.mock('@/services/storage/entries', () => ({ applyTags: jest.fn(), createEntry: jest.fn() }))
jest.mock('@/services/storage/entities', () => ({ setEntitiesForEntry: jest.fn() }))
jest.mock('@/services/wiki/engine', () => ({ updateWikiForEntry: jest.fn() }))
jest.mock('@/services/graph/engine', () => ({ updateGraphForEntry: jest.fn() }))
jest.mock('@/services/pursuits/extractor', () => ({ extractPursuit: jest.fn() }))

const mockBegin = jest.fn()
const mockEnd = jest.fn()
jest.mock('@/store/wiki.store', () => ({
  useWikiStore: { getState: () => ({ begin: mockBegin, end: mockEnd }) },
}))

import { updateWikiForEntry } from '@/services/wiki/engine'
import { updateGraphForEntry } from '@/services/graph/engine'
import { extractPursuit } from '@/services/pursuits/extractor'
import { setEntitiesForEntry } from '@/services/storage/entities'

const mockTagEntry = tagEntry as jest.Mock
const mockApplyTags = applyTags as jest.Mock
const mockCreateEntry = createEntry as jest.Mock
const mockUpdateWiki = updateWikiForEntry as jest.Mock
const mockUpdateGraph = updateGraphForEntry as jest.Mock
const mockExtractPursuit = extractPursuit as jest.Mock
const mockSetEntities = setEntitiesForEntry as jest.Mock

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
  working_on: '',
  pursuit_status: 'active',
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
    mockExtractPursuit.mockReset()
    mockExtractPursuit.mockResolvedValue(undefined)
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
    // no working_on -> no pursuit extraction
    expect(mockExtractPursuit).not.toHaveBeenCalled()
  })

  it('extracts a pursuit when the entry names something being worked on', async () => {
    mockTagEntry.mockResolvedValue(ok(tags({ working_on: 'Marathon training' })))

    await processEntry(entry({ situation: 'ran today', thought: 'felt strong' }))

    expect(mockExtractPursuit).toHaveBeenCalledWith('Marathon training', 'ran today\nfelt strong', 'active')
  })

  it('forwards a done status so the extractor can close the pursuit', async () => {
    mockTagEntry.mockResolvedValue(
      ok(tags({ working_on: 'Marathon training', pursuit_status: 'done' }))
    )

    await processEntry(entry({ situation: 'I finished the race', thought: '' }))

    expect(mockExtractPursuit).toHaveBeenCalledWith('Marathon training', 'I finished the race\n', 'done')
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
    mockApplyTags.mockResolvedValue(ok(undefined))
    mockSetEntities.mockResolvedValue(ok(undefined))
    mockUpdateWiki.mockResolvedValue(ok([]))
    mockUpdateGraph.mockResolvedValue(ok(undefined))
    mockCreateEntry.mockResolvedValue(ok(entry({ id: 'r1', source: 'reflect' })))
  })

  it('captures a message with a new entity as a reflect entry and indexes it', async () => {
    mockTagEntry.mockResolvedValue(ok(tags({ people: ['Sarah'], topic: 'none' })))

    await captureReflectMessage('I had coffee with Sarah today')

    // stored as a reflect-sourced entry, never a journal one
    expect(mockCreateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        situation: 'I had coffee with Sarah today',
        thought: '',
        source: 'reflect',
      })
    )
    // fanned out to entities + wiki/graph, keyed to the new entry id
    expect(mockSetEntities).toHaveBeenCalledWith('r1', [{ type: 'person', label: 'Sarah' }])
    expect(mockUpdateWiki).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      'none'
    )
  })

  it('captures a message that only carries a theme (no entities)', async () => {
    mockTagEntry.mockResolvedValue(ok(tags({ topic: 'Boundaries' })))

    await captureReflectMessage('I think I need firmer boundaries')

    expect(mockCreateEntry).toHaveBeenCalledTimes(1)
    expect(mockUpdateWiki).toHaveBeenCalled()
  })

  it('skips chit-chat with no entities and no real theme', async () => {
    mockTagEntry.mockResolvedValue(ok(tags({ topic: 'none' })))

    await captureReflectMessage('thanks, that helps')

    expect(mockCreateEntry).not.toHaveBeenCalled()
    expect(mockApplyTags).not.toHaveBeenCalled()
    expect(mockUpdateWiki).not.toHaveBeenCalled()
  })

  it('does nothing when tagging fails (never throws)', async () => {
    mockTagEntry.mockResolvedValue(err('TAG_INFERENCE_FAILED', 'model down'))

    await expect(captureReflectMessage('anything')).resolves.toBeUndefined()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })
})
