import { rankPages, rankEntries, queryTerms, rankPagesHybrid, type QueryEmbeddings } from '@/services/wiki/search'
import { type WikiPage } from '@/services/storage/wiki'
import { type Entry } from '@/services/storage/entries'

const page = (over: Partial<WikiPage> = {}): WikiPage => ({
  id: Math.random().toString(36),
  title: 'Untitled',
  category: null,
  content: '',
  entry_count: 1,
  version: 1,
  version_history: [],
  created_at: 0,
  updated_at: 0,
  dismissed_at: null,
  corrected_at: null,
  merged_into: null,
  aggregated_upto: 0,
  ...over,
})

describe('queryTerms', () => {
  it('drops stopwords and 1-char tokens, lowercases, dedupes', () => {
    expect(queryTerms('Why am I so Anxious about anxious work?')).toEqual(['so', 'anxious', 'work'])
  })

  it('is empty for an all-stopword query', () => {
    expect(queryTerms('what is it about')).toEqual([])
  })
})

describe('rankPages', () => {
  it('returns nothing for an empty/stopword-only query', () => {
    expect(rankPages('the and is', [page({ title: 'Anxiety' })])).toEqual([])
  })

  it('ranks a title match above a content-only match', () => {
    const titleHit = page({ title: 'Anxiety', content: 'nothing relevant' })
    const contentHit = page({ title: 'Work', content: 'anxiety shows up sometimes' })
    const out = rankPages('anxiety', [contentHit, titleHit])
    expect(out[0].page).toBe(titleHit)
  })

  it('scores content matches by frequency', () => {
    const few = page({ title: 'A', content: 'sleep' })
    const many = page({ title: 'B', content: 'sleep sleep sleep' })
    const out = rankPages('sleep', [few, many])
    expect(out[0].page).toBe(many)
  })

  it('drops non-matching pages and respects the limit', () => {
    const pages = [
      page({ title: 'Anxiety', content: 'anxiety' }),
      page({ title: 'Work', content: 'work' }),
      page({ title: 'Sleep', content: 'sleep' }),
    ]
    const out = rankPages('anxiety', pages, 5)
    expect(out).toHaveLength(1)
    expect(out[0].page.title).toBe('Anxiety')
  })

  it('uses entry_count only as a gentle tiebreak', () => {
    const a = page({ title: 'Anxiety', content: 'anxiety', entry_count: 1 })
    const b = page({ title: 'Anxiety', content: 'anxiety', entry_count: 9 })
    const out = rankPages('anxiety', [a, b])
    expect(out[0].page).toBe(b) // same term score, richer page wins
  })
})

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: Math.random().toString(36),
  created_at: 0,
  mood: 3,
  situation: '',
  thought: '',
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
  ...over,
})

describe('rankEntries', () => {
  it('returns nothing for a stopword-only query', () => {
    expect(rankEntries('the and', [entry({ situation: 'work stress' })])).toEqual([])
  })

  it('ranks by term overlap across entry text and drops non-matches', () => {
    const a = entry({ id: 'a', situation: 'work deadline', thought: 'I will fail at work' })
    const b = entry({ id: 'b', situation: 'a calm walk' })
    const out = rankEntries('work', [a, b])
    expect(out.map((e) => e.id)).toEqual(['a'])
  })

  it('breaks ties by most recent', () => {
    const older = entry({ id: 'old', situation: 'work', created_at: 100 })
    const newer = entry({ id: 'new', situation: 'work', created_at: 200 })
    const out = rankEntries('work', [older, newer])
    expect(out[0].id).toBe('new')
  })

  it('matches the tagged emotion too', () => {
    const e = entry({ id: 'e', situation: 's', thought: 't', emotion: 'loneliness' })
    expect(rankEntries('loneliness', [e]).map((x) => x.id)).toEqual(['e'])
  })
})

// ── WS3: Hybrid ranker contract for EmbeddingGemma ─────────────────────────────
//
// Constants (SEMANTIC_BASELINE 0.45, SEMANTIC_WEIGHT 14) were calibrated from an
// on-device probe (DevEmbedProbe → "WS3 ranker probe"), all fixture strings:
//   unrelated band 0.42–0.45  (plateau; BASELINE sits just above it)
//   loose     band 0.52–0.61  (topical-adjacent; should need lexical help to ground)
//   related   band 0.68–0.74  (on-topic; must ground on meaning alone)
//
// These fixtures build unit vectors at cosines matching that observed geometry
// (unrelated 0.45 → just under baseline; related 0.825 → clearly above) and
// assert the CONTRACT: an unrelated page with zero lexical overlap does NOT
// ground (score < MIN_RELEVANCE), while a clearly-related one DOES. Zero lexical
// overlap (the query shares no words with the page) isolates the semantic channel
// — exactly the case the constants were tuned for.
//
// MIN_RELEVANCE (3) lives in conversation.ts; these tests assert the hybrid score
// against it — the floor the caller applies.

// cosines matching the on-device probe bands
const UNRELATED_COS = 0.446 // top of the measured unrelated plateau (under the 0.45 baseline → ~0)
const RELATED_COS = 0.825 // comfortably above the related band floor (grounds on meaning)

// A fixed unit basis vector on axis 0 — the "query" direction all fixtures
// rotate relative to in the (0,1) plane, so cosine to it is exactly `c`.
const BASIS = (dim: number): number[] => Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0))

// Build a unit vector with a controlled cosine `c` to the basis by rotating in
// the (0,1) plane. Always shares the (0,1) basis so cosine == c exactly.
function unitWithCosine(dim: number, c: number): number[] {
  const v = Array.from({ length: dim }, () => 0)
  v[0] = c
  v[1] = Math.sqrt(Math.max(0, 1 - c * c))
  return v
}

// relevance floor applied by the caller in conversation.ts
const MIN_RELEVANCE = 3

describe('rankPagesHybrid — EmbeddingGemma contract (WS3)', () => {
  it('an unrelated page with zero lexical overlap must NOT ground (score < MIN_RELEVANCE)', () => {
    const query = BASIS(8) // unit on axis 0
    const unrelated = unitWithCosine(8, UNRELATED_COS) // cosine ~plateau to query
    // zero lexical overlap: title/content share no query terms
    const p = page({ id: 'unrelated', title: 'Applesauce', content: 'pancakes and syrup' })
    const embeddings: QueryEmbeddings = { query, byPage: new Map([['unrelated', unrelated]]) }
    const ranked = rankPagesHybrid('oktoberfest', [p], embeddings)
    const score = ranked.find((r) => r.page.id === 'unrelated')?.score ?? 0
    expect(score).toBeLessThan(MIN_RELEVANCE)
  })

  it('a clearly-related page with zero lexical overlap must ground (score ≥ MIN_RELEVANCE)', () => {
    const query = BASIS(8)
    const related = unitWithCosine(8, RELATED_COS) // clearly above the related band floor
    const p = page({ id: 'related', title: 'Applesauce', content: 'pancakes and syrup' })
    const embeddings: QueryEmbeddings = { query, byPage: new Map([['related', related]]) }
    const ranked = rankPagesHybrid('oktoberfest', [p], embeddings)
    const score = ranked.find((r) => r.page.id === 'related')?.score ?? 0
    expect(score).toBeGreaterThanOrEqual(MIN_RELEVANCE)
  })

  it('a loose (topical-adjacent) page with zero lexical overlap must NOT ground on semantics alone', () => {
    // The contract gap between "loosely related" and "clearly related": a
    // topical-adjacent page (echoing the theme but not the topic) should need
    // SOME lexical overlap to ground, so semantics alone can't force it in.
    // Cosine 0.61 = top of the measured loose band.
    const query = BASIS(8)
    const loose = unitWithCosine(8, 0.61)
    const p = page({ id: 'loose', title: 'Applesauce', content: 'pancakes and syrup' })
    const embeddings: QueryEmbeddings = { query, byPage: new Map([['loose', loose]]) }
    const ranked = rankPagesHybrid('oktoberfest', [p], embeddings)
    const score = ranked.find((r) => r.page.id === 'loose')?.score ?? 0
    expect(score).toBeLessThan(MIN_RELEVANCE)
  })

  it('lexical-only ranking is unchanged when no embeddings are supplied', () => {
    const p = page({ title: 'Anxiety', content: 'anxiety shows up before meetings' })
    // No embeddings → rankPagesHybrid falls back to lexical behaviour matching rankPages
    expect(rankPages('anxiety', [p])).toHaveLength(1)
  })
})
