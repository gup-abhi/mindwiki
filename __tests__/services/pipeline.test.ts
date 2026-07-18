import {
  processEntry,
  captureReflectMessage,
  queueReflectCapture,
  flushReflectCaptures,
  pauseReflectCaptures,
  resumeReflectCaptures,
  capturePathAnswers,
  catchUpUnindexed,
} from '@/services/pipeline'
import { scoreCrisis } from '@/services/llm/fast-model'
import { extractEntry } from '@/services/llm/deep-model'
import {
  applyTags,
  createEntry,
  listUnindexedEntries,
  listWikiPendingEntries,
  listGraphPendingEntries,
  markWikiIndexed,
  markGraphIndexed,
  type Entry,
} from '@/services/storage/entries'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { ok, err } from '@/types/result'

// The deep extract → graph/wiki run as a fire-and-forget chain after the deep
// `await`; let those microtasks settle before asserting on them.
const flush = () => new Promise<void>((r) => setImmediate(r))

jest.mock('@/services/llm/fast-model', () => ({ scoreCrisis: jest.fn() }))
jest.mock('@/services/llm/deep-model', () => ({ extractEntry: jest.fn() }))
jest.mock('@/services/storage/entries', () => ({
  applyTags: jest.fn(),
  createEntry: jest.fn(),
  listUnindexedEntries: jest.fn(),
  listWikiPendingEntries: jest.fn(),
  listGraphPendingEntries: jest.fn(),
  markWikiIndexed: jest.fn(),
  markGraphIndexed: jest.fn(),
}))
jest.mock('@/services/llm/model-manager', () => ({ isModelDownloaded: jest.fn() }))
jest.mock('@/services/storage/entities', () => ({ setEntitiesForEntry: jest.fn() }))
jest.mock('@/services/wiki/engine', () => ({ updateWikiForEntry: jest.fn() }))
jest.mock('@/services/graph/engine', () => ({ updateGraphForEntry: jest.fn(), rebuildGraph: jest.fn() }))
jest.mock('@/services/storage/settings', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }))
jest.mock('@/services/notifications/scheduler', () => ({
  onEntrySaved: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  sendFirstPageReadyNotification: jest.fn().mockResolvedValue({ success: true, data: undefined }),
}))
jest.mock('@/services/onboarding/first-run', () => ({
  announceFirstRunPageIfPending: jest.fn().mockResolvedValue(null),
}))

const mockBegin = jest.fn()
const mockEnd = jest.fn()
jest.mock('@/store/wiki.store', () => ({
  useWikiStore: { getState: () => ({ begin: mockBegin, end: mockEnd }) },
}))

const mockBumpRevision = jest.fn()
jest.mock('@/store/sync.store', () => ({
  useSyncStore: { getState: () => ({ bumpRevision: mockBumpRevision }) },
}))

import { updateWikiForEntry } from '@/services/wiki/engine'
import { updateGraphForEntry, rebuildGraph } from '@/services/graph/engine'
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
const mockListUnindexed = listUnindexedEntries as jest.Mock
const mockListWikiPending = listWikiPendingEntries as jest.Mock
const mockListGraphPending = listGraphPendingEntries as jest.Mock
const mockMarkWikiIndexed = markWikiIndexed as jest.Mock
const mockMarkGraphIndexed = markGraphIndexed as jest.Mock
const mockRebuildGraph = rebuildGraph as jest.Mock
const mockIsModelDownloaded = isModelDownloaded as jest.Mock

// Fast model now scores crisis only.
const crisis = (conf: number) => ok({ crisis_confidence: conf })

// Deep model extracts everything that feeds the knowledge base (canonical).
const extract = (over: Record<string, unknown> = {}) =>
  ok({
    emotion: 'Anxiety',
    distortion: 'none',
    distortion_confidence: 0,
    mood_score: 0.4,
    topics: ['Work'],
    people: [],
    places: [],
    activities: [],
    beliefs: [],
    behaviors: [],
    restatement: '',
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
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  topic2: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
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
    mockBumpRevision.mockReset()
    mockMarkWikiIndexed.mockReset().mockResolvedValue(ok(undefined))
    mockMarkGraphIndexed.mockReset().mockResolvedValue(ok(undefined))
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
      topic2: '',
    })
    // entities persisted (people + places mapped to typed rows)
    expect(mockSetEntities).toHaveBeenCalledWith('e1', [
      { type: 'person', label: 'Sarah' },
      { type: 'place', label: 'Office' },
    ])
    // graph + wiki kicked off with the extracted entry + topics array
    expect(mockUpdateGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', emotion: 'Anxiety' }),
      ['Work']
    )
    expect(mockUpdateWiki).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', emotion: 'Anxiety', distortion: 'none' }),
      ['Work']
    )
    expect(mockBegin).toHaveBeenCalledTimes(1)
    expect(mockEnd).toHaveBeenCalledTimes(1)
    // graph + wiki both resolved → the entry is stamped on each so catch-up
    // won't re-index it
    expect(mockMarkGraphIndexed).toHaveBeenCalledWith('e1')
    expect(mockMarkWikiIndexed).toHaveBeenCalledWith('e1')
    // tags persisted → bump the data revision so the focused timeline re-reads
    // and the EntryCard's "tagging…" flips to the real tags without a refocus
    expect(mockBumpRevision).toHaveBeenCalledTimes(1)
  })

  it('persists extracted beliefs and behaviors as typed entity rows', async () => {
    mockScoreCrisis.mockResolvedValue(crisis(0.1))
    mockExtractEntry.mockResolvedValue(
      extract({ beliefs: ['I am not good enough'], behaviors: ['Avoidance'] })
    )

    await processEntry(entry())
    await flush()

    expect(mockSetEntities).toHaveBeenCalledWith('e1', [
      { type: 'belief', label: 'I am not good enough' },
      { type: 'behavior', label: 'Avoidance' },
    ])
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
    expect(mockBumpRevision).not.toHaveBeenCalled() // nothing changed → no UI refresh
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

  it('extracts a question but never ingests it (recurrence gate — one-off query)', async () => {
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Sadness triggers'] }))

    await captureReflectMessage('What tends to trigger my Sadness?')

    // Extraction runs on everything now — the trailing-? heuristic was too
    // aggressive (lost "why do I always do this?" disclosures). The recurrence
    // gate (2 mentions) is the real filter: one-off queries park at count=1.
    expect(mockExtractEntry).toHaveBeenCalled()
    expect(mockCreateEntry).not.toHaveBeenCalled()
  })

  it('skips the FIRST mention of a theme but parks its text with the count', async () => {
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Boundaries'] }))

    await captureReflectMessage('I think I need firmer boundaries')

    // counted (now seen once) and the text parked — but not yet ingested
    const [key, raw] = mockSetSetting.mock.calls[0]
    expect(key).toBe('reflect:theme:boundaries')
    expect(JSON.parse(raw)).toMatchObject({ count: 1, first: 'I think I need firmer boundaries' })
    expect(mockCreateEntry).not.toHaveBeenCalled()
    expect(mockUpdateWiki).not.toHaveBeenCalled()
  })

  it('captures a theme once it recurs (second mention, legacy bare counter)', async () => {
    mockGetSetting.mockResolvedValue({ success: true, data: '1' }) // seen once, pre-parking format
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Boundaries'] }))

    await captureReflectMessage('I really do need firmer boundaries with work')

    await flush() // background index → wiki

    const [key, raw] = mockSetSetting.mock.calls[0]
    expect(key).toBe('reflect:theme:boundaries')
    // Legacy counter had no parked text — only this mention is ingested.
    expect(JSON.parse(raw)).toMatchObject({ count: 2, first: null })
    expect(mockCreateEntry).toHaveBeenCalledTimes(1)
    expect(mockCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'reflect' }))
    expect(mockUpdateWiki).toHaveBeenCalled()
  })

  it('ingests the parked first mention along with the mention that trips the gate', async () => {
    mockGetSetting.mockResolvedValue({
      success: true,
      data: JSON.stringify({ count: 1, last: Date.now(), first: 'I think I need firmer boundaries' }),
    })
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Boundaries'] }))

    await captureReflectMessage('Boundaries keep slipping at work')
    await flush()

    // Parked text re-extracted for its own tags, then BOTH statements persisted,
    // first mention first (older).
    expect(mockExtractEntry).toHaveBeenCalledTimes(2)
    expect(mockExtractEntry).toHaveBeenNthCalledWith(
      2,
      { situation: 'I think I need firmer boundaries', thought: '' },
      { restate: true } // parked re-extract: its conversation is gone, no context
    )
    expect(mockCreateEntry).toHaveBeenCalledTimes(2)
    expect(mockCreateEntry.mock.calls[0][0]).toMatchObject({
      situation: 'I think I need firmer boundaries',
      source: 'reflect',
    })
    expect(mockCreateEntry.mock.calls[1][0]).toMatchObject({
      situation: 'Boundaries keep slipping at work',
      source: 'reflect',
    })
    // Stash cleared so the first mention is never ingested twice.
    const [, raw] = mockSetSetting.mock.calls[0]
    expect(JSON.parse(raw)).toMatchObject({ count: 2, first: null })
  })

  it('stores the distilled restatement as situation, keeping the raw message for provenance', async () => {
    mockGetSetting.mockResolvedValue({ success: true, data: '1' }) // gate passes
    mockExtractEntry.mockResolvedValue(
      extract({ topics: ['Sleep'], restatement: 'My anxiety is worse at night' })
    )

    await captureReflectMessage("yeah exactly, and it's worse at night", 'Companion: sounds like anxiety')
    await flush()

    // Extraction ran in restate mode with the conversation context attached.
    expect(mockExtractEntry).toHaveBeenCalledWith(
      { situation: "yeah exactly, and it's worse at night", thought: '' },
      { restate: true, context: 'Companion: sounds like anxiety' }
    )
    // The self-contained restatement grounds the entry (and thus the wiki);
    // the fragment as typed is kept as provenance.
    expect(mockCreateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        situation: 'My anxiety is worse at night',
        raw_text: "yeah exactly, and it's worse at night",
        source: 'reflect',
      })
    )
  })

  it('falls back to the raw message when the restatement comes back empty', async () => {
    mockGetSetting.mockResolvedValue({ success: true, data: '1' }) // gate passes
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Sleep'], restatement: '' }))

    await captureReflectMessage('I sleep badly before deadlines')
    await flush()

    expect(mockCreateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        situation: 'I sleep badly before deadlines',
        raw_text: 'I sleep badly before deadlines',
      })
    )
  })

  it('keeps the first mention parked when its re-extract fails, and retries later', async () => {
    mockGetSetting.mockResolvedValue({
      success: true,
      data: JSON.stringify({ count: 1, last: Date.now(), first: 'the first statement' }),
    })
    mockExtractEntry
      .mockResolvedValueOnce(extract({ topics: ['Boundaries'] })) // current message
      .mockResolvedValueOnce(err('EXTRACT_INFERENCE_FAILED', 'model busy')) // parked retry
    await captureReflectMessage('boundaries again today')
    await flush()

    // Current mention still ingested; parked text preserved for the next mention.
    expect(mockCreateEntry).toHaveBeenCalledTimes(1)
    const [, raw] = mockSetSetting.mock.calls[0]
    expect(JSON.parse(raw)).toMatchObject({ count: 2, first: 'the first statement' })
  })

  it('resets a stale pending theme — mentions a year apart are not recurrence', async () => {
    mockGetSetting.mockResolvedValue({
      success: true,
      data: JSON.stringify({
        count: 1,
        last: Date.now() - 365 * 24 * 60 * 60 * 1000,
        first: 'a long-forgotten statement',
      }),
    })
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Boundaries'] }))

    await captureReflectMessage('I need firmer boundaries')

    // Treated as a fresh first mention: nothing ingested, new text parked.
    expect(mockCreateEntry).not.toHaveBeenCalled()
    const [, raw] = mockSetSetting.mock.calls[0]
    expect(JSON.parse(raw)).toMatchObject({ count: 1, first: 'I need firmer boundaries' })
  })

  it('skips a statement with no real theme', async () => {
    mockExtractEntry.mockResolvedValue(extract({ topics: ['none'] }))

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

describe('deferred reflect capture queue', () => {
  beforeEach(() => {
    mockExtractEntry.mockReset()
    mockCreateEntry.mockReset()
    mockGetSetting.mockReset().mockResolvedValue({ success: true, data: null })
    mockSetSetting.mockReset().mockResolvedValue({ success: true, data: undefined })
  })

  it('queueing does no model work; flush processes messages in order, then drains', async () => {
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Boundaries'] }))

    queueReflectCapture('first boundaries note')
    queueReflectCapture('second boundaries note', 'Companion: context')
    // Nothing runs while the chat is live — that would contend with the reply
    // on the shared deep-model lock.
    expect(mockExtractEntry).not.toHaveBeenCalled()

    await flushReflectCaptures()

    expect(mockExtractEntry).toHaveBeenCalledTimes(2)
    expect(mockExtractEntry).toHaveBeenNthCalledWith(
      1,
      { situation: 'first boundaries note', thought: '' },
      { restate: true, context: null }
    )
    expect(mockExtractEntry).toHaveBeenNthCalledWith(
      2,
      { situation: 'second boundaries note', thought: '' },
      { restate: true, context: 'Companion: context' }
    )

    // Drained: a second flush does nothing.
    await flushReflectCaptures()
    expect(mockExtractEntry).toHaveBeenCalledTimes(2)
  })

  it('pausing stops the drain between items; resuming lets the next flush finish it', async () => {
    mockExtractEntry.mockImplementation(async () => {
      // A live chat regains focus while the first capture is mid-flight.
      pauseReflectCaptures()
      return extract({ topics: ['Boundaries'] })
    })
    queueReflectCapture('first note')
    queueReflectCapture('second note')

    await flushReflectCaptures()
    // First item completed, second stayed queued — the deep lock frees for replies.
    expect(mockExtractEntry).toHaveBeenCalledTimes(1)

    resumeReflectCaptures()
    mockExtractEntry.mockResolvedValue(extract({ topics: ['Boundaries'] }))
    await flushReflectCaptures()
    expect(mockExtractEntry).toHaveBeenCalledTimes(2)
  })

  it('a failing capture never blocks the rest of the queue', async () => {
    mockExtractEntry
      .mockRejectedValueOnce(new Error('model exploded'))
      .mockResolvedValue(extract({ topics: ['Sleep'] }))

    queueReflectCapture('this one fails')
    queueReflectCapture('this one still runs')

    await flushReflectCaptures()

    expect(mockExtractEntry).toHaveBeenCalledTimes(2)
  })
})

describe('capturePathAnswers', () => {
  beforeEach(() => {
    mockScoreCrisis.mockReset()
    mockExtractEntry.mockReset()
    mockApplyTags.mockReset().mockResolvedValue(ok(undefined))
    mockCreateEntry.mockReset()
    mockSetEntities.mockReset().mockResolvedValue(ok(undefined))
    mockUpdateWiki.mockReset().mockResolvedValue(ok([]))
    mockUpdateGraph.mockReset().mockResolvedValue(ok(undefined))
    mockBegin.mockReset()
    mockEnd.mockReset()
    mockScoreCrisis.mockResolvedValue(crisis(0))
    mockExtractEntry.mockResolvedValue(extract())
    mockCreateEntry.mockResolvedValue(ok(entry({ id: 'p1', source: 'path' })))
  })

  it('creates a source:path entry per non-empty answer and indexes it', async () => {
    await capturePathAnswers(['I felt stuck', '', '  ', 'I need rest'])
    await flush()

    // Empties are dropped; each real answer becomes a path entry.
    expect(mockCreateEntry).toHaveBeenCalledTimes(2)
    expect(mockCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'path' }))
    expect(mockUpdateWiki).toHaveBeenCalled()
  })

  it('crisis-scores the combined answers once and returns the assessment', async () => {
    mockScoreCrisis.mockResolvedValue(crisis(0.9))

    const result = await capturePathAnswers(['first', 'second'])

    expect(mockScoreCrisis).toHaveBeenCalledTimes(1)
    expect(mockScoreCrisis).toHaveBeenCalledWith(
      expect.objectContaining({ situation: 'first\nsecond' })
    )
    expect(result.crisis.tier).toBeGreaterThanOrEqual(2) // 0.9 confidence → confident tier
  })

  it('does nothing and reports no crisis when every answer is blank', async () => {
    const result = await capturePathAnswers(['', '   '])

    expect(mockScoreCrisis).not.toHaveBeenCalled()
    expect(mockCreateEntry).not.toHaveBeenCalled()
    expect(result.crisis.tier).toBe(0)
  })

  it('still creates the entry when the extract fails, but skips indexing (ADR 004)', async () => {
    mockExtractEntry.mockResolvedValue(err('EXTRACT_INFERENCE_FAILED', 'model down'))

    await expect(capturePathAnswers(['something real'])).resolves.toBeDefined()
    await flush()
    // The entry is saved regardless — the path day must count even if the model
    // is down; only the wiki/graph enrichment is skipped.
    expect(mockCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'path' }))
    expect(mockUpdateWiki).not.toHaveBeenCalled()
  })
})

describe('catchUpUnindexed', () => {
  beforeEach(() => {
    mockIsModelDownloaded.mockReset().mockResolvedValue(true)
    mockListUnindexed.mockReset().mockResolvedValue(ok([]))
    mockListWikiPending.mockReset().mockResolvedValue(ok([]))
    mockListGraphPending.mockReset().mockResolvedValue(ok([]))
    mockMarkWikiIndexed.mockReset().mockResolvedValue(ok(undefined))
    mockMarkGraphIndexed.mockReset().mockResolvedValue(ok(undefined))
    mockRebuildGraph.mockReset().mockResolvedValue(ok(undefined))
    mockExtractEntry.mockReset().mockResolvedValue(extract())
    mockApplyTags.mockReset().mockResolvedValue(ok(undefined))
    mockSetEntities.mockReset().mockResolvedValue(ok(undefined))
    mockUpdateWiki.mockReset().mockResolvedValue(ok([]))
    mockUpdateGraph.mockReset().mockResolvedValue(ok(undefined))
    mockBegin.mockReset()
    mockEnd.mockReset()
  })

  it('re-indexes each un-indexed entry when the deep model is present', async () => {
    mockListUnindexed.mockResolvedValue(ok([entry({ id: 'u1' }), entry({ id: 'u2' })]))

    await catchUpUnindexed()
    await flush()

    expect(mockExtractEntry).toHaveBeenCalledTimes(2)
    expect(mockUpdateWiki).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the deep model is not downloaded (no churn)', async () => {
    mockIsModelDownloaded.mockResolvedValue(false)

    await catchUpUnindexed()

    expect(mockListUnindexed).not.toHaveBeenCalled()
    expect(mockExtractEntry).not.toHaveBeenCalled()
  })

  it('does nothing when there are no un-indexed entries', async () => {
    mockListUnindexed.mockResolvedValue(ok([]))

    await catchUpUnindexed()

    expect(mockExtractEntry).not.toHaveBeenCalled()
  })

  it('re-runs ONLY the wiki step for a tagged-but-wiki-pending entry (no graph, no re-extract)', async () => {
    mockListWikiPending.mockResolvedValue(ok([entry({ id: 'w1', tagged_at: 1, topic: 'Work' })]))

    await catchUpUnindexed()
    await flush()

    // Wiki re-synthesized and marked done...
    expect(mockUpdateWiki).toHaveBeenCalledTimes(1)
    expect(mockMarkWikiIndexed).toHaveBeenCalledWith('w1')
    // ...but the entry is NOT re-extracted (tags already persisted) and the graph
    // is NOT re-run (additive edges would double-count).
    expect(mockExtractEntry).not.toHaveBeenCalled()
    expect(mockUpdateGraph).not.toHaveBeenCalled()
  })

  it('does not mark wiki-indexed when the re-run synthesis fails', async () => {
    mockListWikiPending.mockResolvedValue(ok([entry({ id: 'w1', tagged_at: 1 })]))
    mockUpdateWiki.mockResolvedValue(err('WIKI_FAILED', 'boom'))

    await catchUpUnindexed()
    await flush()

    expect(mockUpdateWiki).toHaveBeenCalledTimes(1)
    expect(mockMarkWikiIndexed).not.toHaveBeenCalled()
  })

  it('heals graph-pending entries with a single rebuildGraph (not a per-entry re-run)', async () => {
    mockListGraphPending.mockResolvedValue(
      ok([entry({ id: 'g1', tagged_at: 1 }), entry({ id: 'g2', tagged_at: 1 })])
    )

    await catchUpUnindexed()
    await flush()

    // One rebuild heals the whole backlog — no per-entry updateGraphForEntry
    // (which would double-count additive edges).
    expect(mockRebuildGraph).toHaveBeenCalledTimes(1)
    expect(mockUpdateGraph).not.toHaveBeenCalled()
  })

  it('does not rebuild the graph when nothing is graph-pending', async () => {
    mockListGraphPending.mockResolvedValue(ok([]))

    await catchUpUnindexed()
    await flush()

    expect(mockRebuildGraph).not.toHaveBeenCalled()
  })
})
