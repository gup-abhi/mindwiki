import { type Entry } from '@/services/storage/entries'
import { type WikiPage } from '@/services/storage/wiki'

export interface RankedPage {
  page: WikiPage
  score: number
}

/** The semantic inputs for hybrid ranking: a query vector + per-page vectors. */
export interface QueryEmbeddings {
  query: number[]
  byPage: Map<string, number[]>
}

// Common words that shouldn't drive relevance.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'am', 'was', 'were', 'be', 'to', 'of', 'and', 'or',
  'in', 'on', 'at', 'for', 'with', 'about', 'i', 'my', 'me', 'you', 'it', 'this', 'that',
  'what', 'why', 'how', 'when', 'where', 'who', 'do', 'does', 'did', 'have', 'has',
])

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1)
}

/** Meaningful query terms (lowercased, stopwords + 1-char tokens removed). */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query).filter((t) => !STOPWORDS.has(t)))]
}

/** Raw term-overlap score for one page: title matches weigh 5, content by
 * frequency. No richness boost (callers add it). 0 = no overlap. */
function lexicalScore(terms: string[], page: WikiPage): number {
  const titleSet = new Set(tokenize(page.title))
  const contentCounts = new Map<string, number>()
  for (const w of tokenize(page.content)) {
    contentCounts.set(w, (contentCounts.get(w) ?? 0) + 1)
  }

  let score = 0
  for (const t of terms) {
    if (titleSet.has(t)) score += 5
    score += contentCounts.get(t) ?? 0
  }
  return score
}

const RICHNESS_BOOST = (page: WikiPage): number => Math.min(page.entry_count, 10) * 0.1

/**
 * Rank wiki pages for a query by term overlap: title matches weigh heavily,
 * content matches by frequency, with a small boost for richer pages (entry
 * count). Pure — caller supplies the pages. Pages with no match are dropped.
 */
export function rankPages(query: string, pages: WikiPage[], limit = 5): RankedPage[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const ranked: RankedPage[] = []
  for (const page of pages) {
    const score = lexicalScore(terms, page)
    if (score > 0) {
      ranked.push({ page, score: score + RICHNESS_BOOST(page) })
    }
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Cosine similarity of two vectors; 0 for mismatched/empty/zero vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// Semantic fusion constants calibrated for EmbeddingGemma-300m (Q8, 768-dim),
// swapped in 2026-07-13. Gemma's cosine distribution runs higher and is more
// compressed than bge-small's, so the old 0.3/10 baseline let an unrelated page
// (~0.6 cosine) clear conversation.ts's MIN_RELEVANCE 3 floor on semantics alone
// → over-grounding.
//
// Constants come from an on-device probe (DevEmbedProbe → "WS3 ranker probe")
// over hand-authored query/page pairs, all fixture strings — no user text:
//   unrelated band 0.42–0.45  (plateau; want ~0 semantic contribution)
//   loose     band 0.52–0.61  (topical-adjacent; should need lexical help)
//   related   band 0.68–0.74  (on-topic; must ground on meaning alone)
//
// BASELINE 0.45 sits just above the unrelated plateau so unrelated pages
// contribute ~0. WEIGHT 14 is the floor of the window that separates the bands:
//   related floor (0.675): 14 × 0.225 = 3.15 ≥ MIN_RELEVANCE 3 (grounds) ✓
//   loose top   (0.607):  14 × 0.157 = 2.20 < 3 (needs lexical help) ✓
//   unrelated   (≤0.446): contributes 0 (below baseline) ✓
// Recalibrate via the probe if the embed model changes again.
const SEMANTIC_BASELINE = 0.45
const SEMANTIC_WEIGHT = 14

/**
 * Hybrid ranking: lexical term-overlap PLUS a semantic bonus from embedding
 * similarity. Strictly additive — a page's lexical score is never reduced, so
 * this only ever ADDS recall (semantically-related pages that share no words)
 * over {@link rankPages}; it never demotes a lexical match below itself. Pages
 * with neither signal are dropped. Pure — the caller supplies the vectors (and
 * falls back to rankPages when embeddings are unavailable).
 */
export function rankPagesHybrid(
  query: string,
  pages: WikiPage[],
  embeddings: QueryEmbeddings,
  limit = 5
): RankedPage[] {
  const terms = queryTerms(query)

  const ranked: RankedPage[] = []
  for (const page of pages) {
    const lex = lexicalScore(terms, page)
    const vec = embeddings.byPage.get(page.id)
    const sem = vec ? Math.max(0, cosine(embeddings.query, vec) - SEMANTIC_BASELINE) : 0
    const score = lex + SEMANTIC_WEIGHT * sem
    if (score > 0) {
      ranked.push({ page, score: score + RICHNESS_BOOST(page) })
    }
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Rank journal entries for a query by term overlap across their text
 * (situation, thought, closing note, emotion). Returns the most relevant
 * entries — the evidence a user can open and re-read. Pure.
 */
export function rankEntries(query: string, entries: Entry[], limit = 5): Entry[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const scored: { entry: Entry; score: number }[] = []
  for (const entry of entries) {
    const text = [
      entry.situation,
      entry.thought,
      entry.closing_note ?? '',
      entry.emotion ?? '',
      entry.distortion && entry.distortion !== 'none' ? entry.distortion : '',
    ].join(' ')
    const counts = new Map<string, number>()
    for (const w of tokenize(text)) counts.set(w, (counts.get(w) ?? 0) + 1)

    let score = 0
    for (const t of terms) score += counts.get(t) ?? 0
    if (score > 0) scored.push({ entry, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || b.entry.created_at - a.entry.created_at)
    .slice(0, limit)
    .map((s) => s.entry)
}
