import { captureReflectMessage } from '@/services/pipeline'
import { buildContext } from '@/services/wiki/conversation'
import { extractEntry } from '@/services/llm/deep-model'
import { type WikiPage } from '@/services/storage/wiki'

/**
 * Integration coverage for the Reflect capture-to-wiki loop.
 *
 * Unlike pipeline.test.ts (which mocks updateWikiForEntry outright), this wires
 * the REAL pipeline + REAL wiki engine + REAL retrieval together, mocking only
 * the two non-deterministic native leaves — the deep model's extractEntry and
 * synthesizePage — and backing wiki-page/settings/entries storage with in-memory
 * Maps. It proves a durable Reflect share actually lands as a real wiki page and
 * is then surfaced to the next session's retrieval (the compounding loop).
 */

// Native model leaves — the only pieces we simulate. synthesizePage echoes the
// message so we can assert the share shaped the page's content.
jest.mock('@/services/llm/deep-model', () => ({
  extractEntry: jest.fn(),
  synthesizePage: jest.fn(async (input: { title: string; situation?: string }) => ({
    success: true,
    data: `${input.title}: ongoing reflections. ${input.situation ?? ''}`.trim(),
  })),
  regeneratePage: jest.fn(),
  converseFromWiki: jest.fn(),
  summarizeConversation: jest.fn(),
}))

// In-memory wiki page store faithful enough for get-or-create + versioned update.
jest.mock('@/services/storage/wiki', () => {
  const pages = new Map<string, Record<string, unknown>>()
  let seq = 0
  return {
    getPageByTitle: jest.fn(async (title: string) => ({
      success: true,
      data: pages.get(title) ?? null,
    })),
    createPage: jest.fn(async (input: { title: string; category?: string | null; content?: string }) => {
      const now = Date.now()
      const page = {
        id: `p${++seq}`,
        title: input.title,
        category: input.category ?? null,
        content: input.content ?? '',
        entry_count: 0,
        version: 1,
        version_history: [],
        created_at: now,
        updated_at: now,
        dismissed_at: null,
        corrected_at: null,
        merged_into: null,
      }
      pages.set(page.title, page)
      return { success: true, data: page }
    }),
    updatePage: jest.fn(async (id: string, content: string) => {
      for (const p of pages.values()) {
        if (p.id === id) {
          const title = p.title as string
          const next = {
            ...p,
            content,
            version: (p.version as number) + 1,
            entry_count: (p.entry_count as number) + 1,
            updated_at: Date.now(),
          }
          pages.set(title, next)
          return { success: true, data: next }
        }
      }
      return { success: true, data: null }
    }),
    __getAllPages: () =>
      [...pages.values()].filter((p) => p.dismissed_at == null && p.merged_into == null),
    __reset: () => {
      pages.clear()
      seq = 0
    },
  }
})

// In-memory settings so the recurrence gate really counts across calls.
jest.mock('@/services/storage/settings', () => {
  const store = new Map<string, string>()
  return {
    getSetting: jest.fn(async (k: string) => ({
      success: true,
      data: store.has(k) ? store.get(k) : null,
    })),
    setSetting: jest.fn(async (k: string, v: string) => {
      store.set(k, v)
      return { success: true, data: undefined }
    }),
    __reset: () => store.clear(),
  }
})

// Entries storage: createEntry mints a full Entry; the index markers are inert.
jest.mock('@/services/storage/entries', () => {
  let seq = 0
  return {
    createEntry: jest.fn(async (input: Record<string, unknown>) => ({
      success: true,
      data: {
        id: `e${++seq}`,
        created_at: Date.now(),
        mood: input.mood ?? 3,
        situation: input.situation ?? '',
        thought: input.thought ?? '',
        behavior: null,
        closing_note: null,
        emotion: null,
        named_emotion: null,
        energy: null,
        distortion: null,
        mood_score: null,
        topic: null,
        tagged_at: null,
        wiki_indexed_at: null,
        graph_indexed_at: null,
        source: input.source ?? 'journal',
      },
    })),
    applyTags: jest.fn(async () => ({ success: true, data: undefined })),
    markGraphIndexed: jest.fn(async () => ({ success: true, data: undefined })),
    markWikiIndexed: jest.fn(async () => ({ success: true, data: undefined })),
    listUnindexedEntries: jest.fn(),
    listWikiPendingEntries: jest.fn(),
    listGraphPendingEntries: jest.fn(),
  }
})

// Entities: no recurring people/places here — keep the focus on the theme page.
jest.mock('@/services/storage/entities', () => ({
  setEntitiesForEntry: jest.fn(async () => ({ success: true, data: undefined })),
  listEntitiesForEntry: jest.fn(async () => ({ success: true, data: [] })),
  countEntriesForEntity: jest.fn(async () => ({ success: true, data: 0 })),
}))

jest.mock('@/services/graph/engine', () => ({
  updateGraphForEntry: jest.fn(async () => ({ success: true, data: undefined })),
  rebuildGraph: jest.fn(async () => ({ success: true, data: undefined })),
}))

jest.mock('@/services/storage/reframes', () => ({
  listReframesForBelief: jest.fn(async () => ({ success: true, data: [] })),
}))

jest.mock('@/services/llm/model-manager', () => ({ isModelDownloaded: jest.fn() }))

jest.mock('@/store/wiki.store', () => ({
  useWikiStore: { getState: () => ({ begin: jest.fn(), end: jest.fn() }) },
}))
jest.mock('@/store/sync.store', () => ({
  useSyncStore: { getState: () => ({ bumpRevision: jest.fn() }) },
}))

const mockExtract = extractEntry as jest.Mock

// Test-only inspectors/resetters exposed by the in-memory storage mocks above.
const { __getAllPages, __reset: resetPages } = jest.requireMock('@/services/storage/wiki') as {
  __getAllPages: () => WikiPage[]
  __reset: () => void
}
const { __reset: resetSettings } = jest.requireMock('@/services/storage/settings') as {
  __reset: () => void
}

// Deep extract with an already-canonical topic (extractEntry canonicalizes on the
// real path; the recurrence gate and page title both key on this string).
const extract = (topic: string) => ({
  success: true,
  data: {
    emotion: 'Anxiety',
    distortion: 'none',
    distortion_confidence: 0,
    mood_score: 0.4,
    topic,
    people: [],
    places: [],
    activities: [],
    beliefs: [],
    behaviors: [],
  },
})

describe('Reflect capture → wiki → retrieval (integration)', () => {
  beforeEach(() => {
    resetPages()
    resetSettings()
    mockExtract.mockReset()
  })

  it('parks the first mention and lands BOTH once the theme recurs', async () => {
    mockExtract.mockResolvedValue(extract('Boundaries'))

    // First mention: parked by the recurrence gate, nothing ingested yet.
    await captureReflectMessage('I think I need firmer boundaries at work')
    expect(__getAllPages()).toHaveLength(0)

    // Second mention: the theme is durable — the parked first mention AND this
    // one both flow into the wiki (the first statement is usually the fullest).
    await captureReflectMessage('Boundaries keep slipping and it drains me')

    const pages = __getAllPages() as WikiPage[]
    const themePage = pages.find((p) => p.title === 'Boundaries')
    expect(themePage).toBeDefined()
    // The page is genuinely synthesized (non-empty) and shaped by the message.
    expect(themePage!.content).toContain('Boundaries')
    expect(themePage!.content).toContain('drains me')
    // Two syntheses landed — the parked first mention was ingested, not dropped.
    expect(themePage!.entry_count).toBe(2)

    // Next session: a related message surfaces the captured page via retrieval,
    // clearing the MIN_RELEVANCE floor on the title match alone. This is the
    // compounding loop — the companion "remembers" what was shared in chat.
    const { sources } = buildContext('boundaries have been on my mind again', pages, [], [])
    expect(sources.map((p) => p.title)).toContain('Boundaries')
  })

  it('never lands a question, even when its theme has already recurred', async () => {
    mockExtract.mockResolvedValue(extract('Boundaries'))

    await captureReflectMessage('I need firmer boundaries')
    await captureReflectMessage('Still struggling with boundaries')
    expect(__getAllPages().length).toBeGreaterThan(0)

    const before = __getAllPages().length
    await captureReflectMessage('How do I set better boundaries?')
    // A question is a query, not a self-insight — no new page, no re-synthesis.
    expect(__getAllPages().length).toBe(before)
  })
})
