import { type WikiPage } from '@/services/storage/wiki'
import { listPages } from '@/services/storage/wiki'
import {
  contentWords,
  retention,
  pageDrift,
  driftReport,
  normalizeVersionChain,
} from '@/services/wiki/drift'

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
  aggregated_upto: 0,
    regrounded_upto: 0,
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

// ---------------------------------------------------------------------------
// F-5 — sampled-history gaps + chain validation + lexical labelling
// ---------------------------------------------------------------------------

describe('normalizeVersionChain', () => {
  it('sorts versions ascending and returns an empty gap/issues list for a clean chain', () => {
    const r = normalizeVersionChain([
      { version: 3, content: 'third', updated_at: 30 },
      { version: 1, content: 'first', updated_at: 10 },
      { version: 2, content: 'second', updated_at: 20 },
    ])
    expect(r.versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(r.gaps).toEqual([])
    expect(r.issues).toEqual([])
  })

  it('detects a version-number gap (v1, v2, v14, v15) and reports the missing count', () => {
    const r = normalizeVersionChain([
      { version: 1, content: 'a', updated_at: 10 },
      { version: 2, content: 'b', updated_at: 20 },
      { version: 14, content: 'c', updated_at: 140 },
      { version: 15, content: 'd', updated_at: 150 },
    ])
    expect(r.gaps).toEqual([{ fromVersion: 2, toVersion: 14, missing: 11 }])
    expect(r.issues).toEqual([])
  })

  it('flags duplicate version numbers (last write wins) without crashing', () => {
    const r = normalizeVersionChain([
      { version: 1, content: 'first', updated_at: 10 },
      { version: 1, content: 'first-b', updated_at: 15 },
      { version: 2, content: 'second', updated_at: 20 },
    ])
    expect(r.versions.map((v) => v.version)).toEqual([1, 2])
    // Last write wins → the retained v1 content is the later one.
    expect(r.versions[0].content).toBe('first-b')
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].type).toBe('duplicate-version')
    expect(r.issues[0].version).toBe(1)
  })

  it('flags non-increasing timestamps without crashing', () => {
    const r = normalizeVersionChain([
      { version: 1, content: 'a', updated_at: 100 },
      { version: 2, content: 'b', updated_at: 50 }, // predates v1
      { version: 3, content: 'c', updated_at: 150 },
    ])
    expect(r.issues).toEqual([
      {
        type: 'non-increasing-timestamp',
        version: 2,
        detail: 'version #2 timestamp is not later than version #1',
      },
    ])
  })

  it('never includes page text in issue details (privacy)', () => {
    const r = normalizeVersionChain([
      { version: 1, content: 'SECRET USER TEXT', updated_at: 10 },
      { version: 1, content: 'MORE SECRET', updated_at: 15 },
      { version: 1, content: 'EVEN MORE', updated_at: 5 },
    ])
    const detailBlob = r.issues.map((i) => i.detail).join(' ')
    expect(detailBlob).not.toContain('SECRET')
    expect(detailBlob).not.toContain('USER TEXT')
    expect(detailBlob).not.toContain('MORE')
    expect(detailBlob).not.toContain('EVEN')
  })

  it('detects a duplicate current/live version', () => {
    const r = normalizeVersionChain(
      [{ version: 1, content: 'archived', updated_at: 10 }],
      { version: 1, content: 'live', updated_at: 20 }
    )
    expect(r.versions).toEqual([{ version: 1, content: 'live', updated_at: 20 }])
    expect(r.issues).toEqual([{
      type: 'duplicate-version',
      version: 1,
      detail: 'duplicate version #1 across the retained history; keeping the latest write',
    }])
  })

  it('returns an empty chain for empty input', () => {
    const r = normalizeVersionChain([])
    expect(r.versions).toEqual([])
    expect(r.gaps).toEqual([])
    expect(r.issues).toEqual([])
  })
})

const gappyPage = page({
  id: 'g',
  title: 'Gaps',
  version: 15,
  content: 'storm harbor beacon', // v15
  version_history: [
    { version: 1, content: '', updated_at: 1 },          // empty engine shell
    { version: 2, content: 'storm harbor anchor compass', updated_at: 2 },
    // versions 3–13 discarded by retained-history cap; v14 is sampled back in
    { version: 14, content: 'storm harbor anchor beacon', updated_at: 140 },
  ],
})

describe('pageDrift — F-5 gap handling', () => {
  it('does NOT compute step retention across a sampled gap (v2 → v14)', () => {
    const d = pageDrift(gappyPage)!
    // Only the v14 → v15 step is adjacent (delta === 1). The v2 → v14 step
    // spans 11 discarded versions and contributes no entry to `steps`.
    expect(d.steps).toEqual([0.75]) // 3/4 of v14 words survive in v15
    expect(d.steps).not.toContain(0.25) // the old, dishonest v2→v15 number
  })

  it('records the sampled gap on the report', () => {
    const d = pageDrift(gappyPage)!
    expect(d.gaps).toEqual([{ fromVersion: 2, toVersion: 14, missing: 11 }])
  })

  it('origin retention crosses gaps honestly (first contentful → current)', () => {
    const d = pageDrift(gappyPage)!
    // Origin is v2 (first contentful) → v15: storm and harbor survive = 2/4 = 0.5.
    expect(d.origin).toBe(0.5)
  })

  it('surfaces duplicate-version issues from the chain', () => {
    const d = pageDrift(
      page({
        version: 3,
        content: 'storm beacon',
        version_history: [
          { version: 1, content: 'storm harbor anchor compass', updated_at: 1 },
          { version: 1, content: 'storm harbor anchor compass again', updated_at: 2 },
          { version: 2, content: 'storm harbor anchor beacon', updated_at: 3 },
        ],
      })
    )!
    expect(d.issues).toHaveLength(1)
    expect(d.issues[0].type).toBe('duplicate-version')
  })

  it('surfaces non-increasing-timestamp issues from the chain', () => {
    const d = pageDrift(
      page({
        version: 3,
        content: 'storm beacon',
        version_history: [
          { version: 1, content: 'storm harbor', updated_at: 100 },
          { version: 2, content: 'storm harbor anchor', updated_at: 50 }, // predates v1
        ],
      })
    )!
    expect(d.issues.some((i) => i.type === 'non-increasing-timestamp')).toBe(true)
  })

  it('a one-version page returns null (no comparative retention)', () => {
    const d = pageDrift(
      page({
        version: 1,
        content: 'only one version',
        version_history: [],
      })
    )
    expect(d).toBeNull()
  })

  it('returns the page (with empty steps, gaps surfaced) when a chain has only a sampled gap and no adjacent step', () => {
    // v1 (empty) → v2 ... → v100. No two retained versions are adjacent.
    const d = pageDrift(
      page({
        version: 100,
        content: 'storm harbor',
        version_history: [
          { version: 1, content: '', updated_at: 1 },
          { version: 2, content: 'storm harbor anchor compass', updated_at: 2 },
          // gap of 97 versions
        ],
      })
    )
    expect(d).not.toBeNull()
    expect(d!.steps).toEqual([])
    expect(d!.meanStep).toBe(0)
    expect(d!.minStep).toBe(0)
    expect(d!.gaps).toEqual([{ fromVersion: 2, toVersion: 100, missing: 97 }])
  })
})

describe('driftReport — F-5 summary', () => {
  beforeEach(() => mockListPages.mockReset())

  it('aggregates gappy pages without throwing and counts rewrites as adjacent-step count', async () => {
    mockListPages.mockResolvedValue({ success: true, data: [gappyPage] })
    const res = await driftReport()
    expect(res.success).toBe(true)
    if (!res.success) return
    // rewriteCount reflects measurable adjacent steps, not raw retained rows.
    expect(res.data.rewriteCount).toBe(1) // only the v14→v15 step
    expect(res.data.pageCount).toBe(1)
  })
})
