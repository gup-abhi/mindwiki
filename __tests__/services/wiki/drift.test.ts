import { type WikiPage } from '@/services/storage/wiki'
import { listPages } from '@/services/storage/wiki'
import { contentWords, retention, pageDrift, driftReport } from '@/services/wiki/drift'

jest.mock('@/services/storage/wiki', () => ({
  listPages: jest.fn(),
}))
const mockListPages = listPages as jest.Mock

const page = (over: Partial<WikiPage>): WikiPage => ({
  id: 'x',
  title: 'X',
  category: 'theme',
  content: '',
  entry_count: 0,
  version: 1,
  version_history: [],
  created_at: 0,
  updated_at: 0,
  dismissed_at: null,
  corrected_at: null,
  merged_into: null,
  ...over,
})

describe('contentWords', () => {
  it('lowercases, strips punctuation, and drops function words', () => {
    expect(contentWords('You often brace for the worst before it happens.')).toEqual(
      new Set(['brace', 'worst', 'happens'])
    )
  })

  it('deduplicates repeated words', () => {
    expect(contentWords('storm Storm STORM harbor')).toEqual(new Set(['storm', 'harbor']))
  })

  it('returns an empty set for empty or all-stopword text', () => {
    expect(contentWords('')).toEqual(new Set())
    expect(contentWords('you and the it')).toEqual(new Set())
  })
})

describe('retention', () => {
  it('is 1 when every content word survives (case/punctuation ignored)', () => {
    expect(retention('Storm, harbor!', 'storm harbor anchor')).toBe(1)
  })

  it('is 0 when nothing survives', () => {
    expect(retention('storm harbor', 'lantern beacon')).toBe(0)
  })

  it('is the surviving fraction of the PRIOR version words', () => {
    expect(retention('storm harbor anchor compass', 'storm harbor anchor beacon')).toBe(0.75)
  })

  it('is null when the prior version has no content words', () => {
    expect(retention('', 'storm harbor')).toBeNull()
    expect(retention('you and the', 'storm harbor')).toBeNull()
  })
})

// v1 → v2 keeps 3/4 words (0.75); v2 → current keeps 2/4 (0.5);
// v1 → current keeps 1/4 (origin 0.25).
const driftedPage = page({
  id: 'a',
  title: 'Storms',
  version: 3,
  content: 'storm beacon lantern lighthouse',
  version_history: [
    { version: 1, content: 'storm harbor anchor compass', updated_at: 1 },
    { version: 2, content: 'storm harbor anchor beacon', updated_at: 2 },
  ],
})

const stablePage = page({
  id: 'b',
  title: 'Rivers',
  version: 2,
  content: 'river stone moss fern',
  version_history: [{ version: 1, content: 'river stone moss fern', updated_at: 1 }],
})

describe('pageDrift', () => {
  it('returns null for a page with no prior versions (nothing rewritten yet)', () => {
    expect(pageDrift(page({ content: 'storm harbor' }))).toBeNull()
  })

  it('computes per-rewrite retention, oldest first, plus origin retention', () => {
    const d = pageDrift(driftedPage)
    expect(d).not.toBeNull()
    expect(d!.steps).toEqual([0.75, 0.5])
    expect(d!.meanStep).toBeCloseTo(0.625)
    expect(d!.minStep).toBe(0.5)
    expect(d!.origin).toBe(0.25)
    expect(d!.versions).toBe(3)
  })

  it('scores an unchanged rewrite as full retention', () => {
    const d = pageDrift(stablePage)
    expect(d!.steps).toEqual([1])
    expect(d!.origin).toBe(1)
  })

  it('measures origin from the first contentful version (engine pages start empty)', () => {
    const d = pageDrift(
      page({
        version: 3,
        content: 'storm beacon',
        version_history: [
          { version: 1, content: '', updated_at: 1 }, // created empty by the engine
          { version: 2, content: 'storm harbor anchor compass', updated_at: 2 },
        ],
      })
    )
    expect(d!.steps).toEqual([0.25]) // empty→v2 step unmeasurable, skipped
    expect(d!.origin).toBe(0.25) // from v2, the first version with content
  })

  it('skips steps whose prior version had no content words', () => {
    const d = pageDrift(
      page({
        version: 2,
        content: 'storm harbor',
        version_history: [{ version: 1, content: '', updated_at: 1 }],
      })
    )
    expect(d).toBeNull()
  })
})

describe('driftReport', () => {
  beforeEach(() => mockListPages.mockReset())

  it('aggregates across pages with history, drifty pages first', async () => {
    mockListPages.mockResolvedValue({
      success: true,
      data: [stablePage, driftedPage, page({ id: 'c', content: 'no history yet' })],
    })

    const res = await driftReport()
    expect(res.success).toBe(true)
    if (!res.success) return

    expect(res.data.pageCount).toBe(2)
    expect(res.data.rewriteCount).toBe(3)
    // Pooled over all rewrites: (0.75 + 0.5 + 1) / 3
    expect(res.data.meanStep).toBeCloseTo(0.75)
    expect(res.data.meanOrigin).toBeCloseTo(0.625)
    // Worst mean step retention first.
    expect(res.data.pages.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('handles an empty wiki', async () => {
    mockListPages.mockResolvedValue({ success: true, data: [] })
    const res = await driftReport()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.pageCount).toBe(0)
    expect(res.data.rewriteCount).toBe(0)
  })

  it('propagates a storage failure', async () => {
    mockListPages.mockResolvedValue({
      success: false,
      error: { code: 'WIKI_LIST_FAILED', message: 'x' },
    })
    const res = await driftReport()
    expect(res.success).toBe(false)
  })
})
