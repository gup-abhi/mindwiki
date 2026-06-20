import { processEntry, captureReflectMessage } from '@/services/pipeline'
import { scoreCrisis } from '@/services/llm/fast-model'
import { extractEntry } from '@/services/llm/deep-model'
import { applyTags, createEntry, type Entry } from '@/services/storage/entries'
import { ok, err } from '@/types/result'

// The deep extract → graph/wiki run as a fire-and-forget chain after the deep
// `await`; let those microtasks settle before asserting on them.
const flush = () => new Promise<void>((r) => setImmediate(r))

jest.mock('@/services/llm/fast-model', () => ({ scoreCrisis: jest.fn() }))
jest.mock('@/services/llm/deep-model', () => ({ extractEntry: jest.fn() }))
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

const mockScoreCrisis = scoreCrisis as jest.Mock
const mockExtractEntry = extractEntry as jest.Mock
const mockApplyTags = applyTags as jest.Mock
const mockCreateEntry = createEntry as jest.Mock
const mockUpdateWiki = updateWikiForEntry as jest.Mock
const mockUpdateGraph = updateGraphForEntry as jest.Mock
const mockSetEntities = setEntitiesForEntry as jest.Mock
const mockGetSetting = getSetting as jest.Mock
const mockSetSetting = setSetting as jest.Mock

// Fast model now scores crisis only.
const crisis = (conf: number) => ok({ crisis_confidence: conf })

// Deep model extracts everything that feeds the knowledge base (canonical).
const extract = (over: Record<string, unknown> = {}) =>
  ok({
    emotion: 'Anxiety',
    distortion: 'none',
    distortion_confidence: 0,
    mood_score: 0.4,
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
    mockScoreCrisis.mockReset()
    mockExtractEntry.mockReset()
    mockApplyTags.mockReset()
    mockUpdateWiki.mockReset()
    mockUpdateGraph.mockReset()
    mockSetEntities.mockReset()
    mockBegin.mockReset()
    mockEnd.mockReset()
    mockApplyTags.mockResolvedValue(ok(undefined))
    mockUpdateWiki.mockResolvedValue(ok([]))
    mockUpdateGraph.mockResolvedValue(ok(undefined))
    mockSetEntities.mockResolvedValue(ok(undefined))
    // Default: deep extract fails → entry saved but not indexed.
    mockExtractEntry.mockResolvedValue(err('EXTRACT_INFERENCE_FAILED', 'down'))
  })

  it('assesses crisis from the fast score, then indexes from the deep extract', async () => {
    mockScoreCrisis.mockResolvedValue(crisis(0.65))
    mockExtractEntry.mockResolvedValue(extract({ people: ['Sarah'], places: ['Office'] }))

    const result = await processEntry(entry())

    // crisis comes from the fast model synchronously
    expect(result.crisis.tier).toBe(2) // 0.65 -> tier 2

    await flush() // let the background deep extract → index settle

    // deep extract drives the persisted tags
    expect(mockApplyTags).toHaveBeenCalledWith('e1', {
      emotion: 'Anxiety',
      distortion: 'none',
      mood_score: 0.4,
      topic: 'Work',
    })
    // entities persisted (people + places mapped to typed rows)
    expect(mockSetEntities).toHaveBeenCalledWith('e1', [
      { type: 'person', label: 'Sarah' },
      { type: 'place', label: 'Office' },
    ])
    // graph + wiki kicked off with the extracted entry + topic
    expect(mockUpdateGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', emotion: 'Anxiety' }),
      'Work'
    )
    expect(mockUpdateWiki).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', emotion: 'Anxiety', distortion: 'none' }),
      'Work'
    )
    expect(mockBegin).toHaveBeenCalledTimes(1)
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it('does not touch the knowledge base when the deep extract fails', async () => {
    mockScoreCrisis.mockResolvedValue(crisis(0.1))
    mockExtractEntry.mockResolvedValue(err('EXTRACT_INFERENCE_FAILED', 'down'))

    await processEntry(entry())
    await flush()

    expect(mockApplyTags).not.toHaveBeenCalled()
    expect(mockSetEntities).not.toHaveBeenCalled()
    expect(mockUpdateGraph).not.toHaveBeenCalled()
    expect(mockUpdateWiki).not.toHaveBeenCalled()
  })

  it('still catches an explicit crisis via the keyword net when the crisis score fails', async () => {
    mockScoreCrisis.mockResolvedValue(err('CRISIS_INFERENCE_FAILED', 'model down'))

    const result = await processEntry(entry({ thought: 'I want to die' }))

    expect(result.crisis.tier).toBe(3) // keyword safety net
  })

  it('reports tier 0 for a calm entry with low crisis confidence', async () => {
    mockScoreCrisis.mockResolvedValue(crisis(0.02))

    const result = await processEntry(entry())

    expect(result.crisis.tier).toBe(0)
  })

  it('skips all model work for a mood-only entry (no text)', async () => {
    const result = await processEntry(entry({ situation: '', thought: '' }))
    await flush()

    expect(result.crisis.tier).toBe(0)
    expect(mockScoreCrisis).not.toHaveBeenCalled()
    expect(mockExtractEntry).not.toHaveBeenCalled()
    expect(mockApplyTags).not.toHaveBeenCalled()
  })
})

describe('captureReflectMessage', () => {
  beforeEach(() => {
    mockExtractEntry.mockReset()
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

  it('never ingests a question (no extraction, no capture)', async () => {
    await captureReflectMessage('What tends to trigger my Sadness?')

    expect(mockExtractEntry).not.toHaveBeenCalled()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('skips the FIRST mention of a theme but records it', async () => {
    mockExtractEntry.mockResolvedValue(extract({ topic: 'Boundaries' }))

    await captureReflectMessage('I think I need firmer boundaries')

    // counted (now seen once) but not yet ingested
    expect(mockSetSetting).toHaveBeenCalledWith('reflect:theme:boundaries', '1')
    expect(mockCreateEntry).not.toHaveBeenCalled()
    expect(mockUpdateWiki).not.toHaveBeenCalled()
  })

  it('captures a theme once it recurs (second mention)', async () => {
    mockGetSetting.mockResolvedValue({ success: true, data: '1' }) // seen once before
    mockExtractEntry.mockResolvedValue(extract({ topic: 'Boundaries' }))

    await captureReflectMessage('I really do need firmer boundaries with work')

    await flush() // background index → wiki

    expect(mockSetSetting).toHaveBeenCalledWith('reflect:theme:boundaries', '2')
    expect(mockCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'reflect' }))
    expect(mockUpdateWiki).toHaveBeenCalled()
  })

  it('skips a statement with no real theme', async () => {
    mockExtractEntry.mockResolvedValue(extract({ topic: 'none' }))

    await captureReflectMessage('thanks, that helps')

    expect(mockSetSetting).not.toHaveBeenCalled()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('does nothing when the extract fails (never throws)', async () => {
    mockExtractEntry.mockResolvedValue(err('EXTRACT_INFERENCE_FAILED', 'model down'))

    await expect(captureReflectMessage('I felt calm at the park')).resolves.toBeUndefined()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })
})
