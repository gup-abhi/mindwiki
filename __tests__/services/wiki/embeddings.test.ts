/**
 * Hybrid retrieval: semantic embeddings on top of lexical ranking. These tests
 * pin the two properties that make the feature safe to ship:
 *   1. It only ever ADDS recall — a semantically-related page with no shared
 *      words can surface, but a lexical match is never demoted below itself.
 *   2. It degrades gracefully — no embed model / no vectors → pure lexical, the
 *      reply is never blocked.
 * The native embedding call is mocked; the math (cosine, fusion) and the
 * store/backfill plumbing are real.
 */
import { cosine, rankPages, rankPagesHybrid, type QueryEmbeddings } from '@/services/wiki/search'
import {
  contentHash,
  embedText,
  embedPage,
  backfillStaleEmbeddings,
  buildQueryEmbeddings,
} from '@/services/wiki/embeddings'
import { type WikiPage } from '@/services/storage/wiki'
import { type SqliteDatabase } from '@/services/storage/db'
import { setDb } from '@/services/storage/db'
import { LLMBridge } from '@/native/LLMBridge'

jest.mock('@/native/LLMBridge', () => ({ LLMBridge: { embed: jest.fn() } }))
const mockEmbed = LLMBridge.embed as jest.Mock

function page(title: string, content: string, over: Partial<WikiPage> = {}): WikiPage {
  return {
    id: title.toLowerCase(),
    title,
    category: 'emotion',
    content,
    entry_count: 3,
    version: 1,
    version_history: [],
    created_at: 1,
    updated_at: 1,
    dismissed_at: null,
    corrected_at: null,
    merged_into: null,
    aggregated_upto: 0,
    ...over,
  }
}

// In-memory fake of the page_embeddings table — just enough for the two SQL
// statements page-embeddings.ts issues (upsert + select).
function fakeDb(): SqliteDatabase {
  const rows = new Map<string, { page_id: string; vector: string; content_hash: string }>()
  return {
    async execute(sql, params) {
      if (/^INSERT INTO page_embeddings/.test(sql)) {
        const [pageId, , vector, contentHash] = params as [string, number, string, string]
        rows.set(pageId, { page_id: pageId, vector, content_hash: contentHash })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT page_id, vector, content_hash FROM page_embeddings/.test(sql)) {
        return { rows: [...rows.values()], rowsAffected: 0 }
      }
      return { rows: [], rowsAffected: 0 }
    },
    async transaction(fn) {
      await fn(this)
    },
    close() {},
  }
}

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
  })
  it('is 0 for mismatched length, empty, or zero vectors', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
    expect(cosine([], [])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('embedText', () => {
  beforeEach(() => mockEmbed.mockReset())

  // EmbeddingGemma requires a task prefix; the model card's semantic-similarity
  // format is "task: sentence similarity | query: {text}". The prefix must be
  // applied to EVERY embedded string (belief labels, page text, and queries
  // alike) so all vectors live in the same task space — that symmetry is what
  // the off-device separation check validated.
  it('prepends the EmbeddingGemma sentence-similarity task prefix before embedding', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    await embedText('I am not good enough')
    expect(mockEmbed).toHaveBeenCalledWith('task: sentence similarity | query: I am not good enough')
  })

  it('surfaces an empty vector as an error (best-effort contract unchanged)', async () => {
    mockEmbed.mockResolvedValue([])
    const res = await embedText('x')
    expect(res.success).toBe(false)
  })
})

describe('contentHash', () => {
  it('is stable for the same text and changes when the text changes', () => {
    expect(contentHash('work anxiety\nyou tense up')).toBe(contentHash('work anxiety\nyou tense up'))
    expect(contentHash('a')).not.toBe(contentHash('b'))
  })
})

describe('rankPagesHybrid', () => {
  const PAGES = [
    page('Work anxiety', 'You tense up before meetings and replay them afterward.'),
    page('Sleep', 'You sleep poorly the night before a deadline.'),
  ]
  // "work" page vector close to the query; "sleep" far from it.
  const embeddings: QueryEmbeddings = {
    query: [1, 0, 0],
    byPage: new Map([
      ['work anxiety', [0.95, 0.05, 0]],
      ['sleep', [0, 0, 1]],
    ]),
  }

  it('surfaces a semantically-related page with no shared words (recall gain)', () => {
    // Terse, off-vocabulary message: lexical finds nothing.
    expect(rankPages('ugh dreading it', PAGES, 3)).toEqual([])
    const hybrid = rankPagesHybrid('ugh dreading it', PAGES, embeddings, 3)
    expect(hybrid.map((r) => r.page.title)).toContain('Work anxiety')
    expect(hybrid.find((r) => r.page.title === 'Sleep')).toBeUndefined() // below baseline
  })

  it('never demotes a lexical match below its lexical score (additive only)', () => {
    const lex = rankPages('work meetings', PAGES, 3)
    const hybrid = rankPagesHybrid('work meetings', PAGES, embeddings, 3)
    const lexScore = lex.find((r) => r.page.title === 'Work anxiety')!.score
    const hybScore = hybrid.find((r) => r.page.title === 'Work anxiety')!.score
    expect(hybScore).toBeGreaterThanOrEqual(lexScore)
  })

  it('uses only lexical signal for a page with no stored vector', () => {
    const partial: QueryEmbeddings = { query: [1, 0, 0], byPage: new Map() }
    const hybrid = rankPagesHybrid('work meetings', PAGES, partial, 3)
    const lex = rankPages('work meetings', PAGES, 3)
    expect(hybrid.map((r) => r.page.title)).toEqual(lex.map((r) => r.page.title))
  })
})

describe('embeddings store + backfill', () => {
  beforeEach(() => {
    mockEmbed.mockReset()
    setDb(fakeDb())
  })
  afterEach(() => setDb(null))

  it('embeds a page and persists a retrievable vector', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    const res = await embedPage(page('Work anxiety', 'meetings'))
    expect(res.success).toBe(true)

    const qe = await buildQueryEmbeddings('anything')
    expect(qe).not.toBeNull()
    expect(qe!.byPage.get('work anxiety')).toEqual([0.1, 0.2, 0.3])
  })

  it('backfill embeds new pages, skips unchanged, and re-embeds changed content', async () => {
    mockEmbed.mockResolvedValue([1, 0, 0])
    const p = page('Work anxiety', 'meetings')

    expect(await backfillStaleEmbeddings([p])).toBe(1) // new → embedded
    expect(await backfillStaleEmbeddings([p])).toBe(0) // unchanged → skipped

    const changed = page('Work anxiety', 'meetings and deadlines now')
    expect(await backfillStaleEmbeddings([changed])).toBe(1) // content changed → re-embed
  })

  it('stops the backfill pass when the embed model is unavailable', async () => {
    mockEmbed.mockRejectedValue(new Error('no embed model'))
    expect(await backfillStaleEmbeddings([page('A', 'x'), page('B', 'y')])).toBe(0)
  })

  it('buildQueryEmbeddings returns null when there are no stored vectors', async () => {
    expect(await buildQueryEmbeddings('hi')).toBeNull()
  })

  it('buildQueryEmbeddings returns null when the query embed fails', async () => {
    mockEmbed.mockResolvedValueOnce([1, 0, 0]) // seed one page vector
    await embedPage(page('Work anxiety', 'meetings'))
    mockEmbed.mockRejectedValueOnce(new Error('embed down')) // query embed fails
    expect(await buildQueryEmbeddings('hi')).toBeNull()
  })
})
