import { listPages, type WikiPage } from '@/services/storage/wiki'
import { type Result, ok } from '@/types/result'

/**
 * Drift metric for the synthesize-merge wiki: every entry rewrites the whole
 * page, so substance can quietly wash out over many rewrites. This measures it
 * from version_history — the fraction of a version's content words that survive
 * the next rewrite (step retention) and that survive from v1 to the current page
 * (origin retention) — to settle with data whether a consolidation pass is
 * needed (see the deferred wiki-drift question). Pure word-set overlap: cheap,
 * deterministic, model-independent, same spirit as the eval harness's
 * checkHouseStyle. Runs on-device only; nothing here is ever logged.
 */

// Function/filler words that say nothing about a page's substance. Includes the
// second-person scaffolding every page shares ("you tend to…") so retention
// tracks the *specifics* surviving a rewrite, not the house style.
const STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'nor', 'yet', 'you', 'your', 'yours', 'yourself',
  'this', 'that', 'these', 'those', 'they', 'them', 'their', 'there', 'then',
  'than', 'when', 'where', 'which', 'what', 'who', 'how', 'why', 'while',
  'with', 'without', 'about', 'into', 'onto', 'over', 'under', 'before',
  'after', 'during', 'between', 'through', 'from', 'have', 'has', 'had',
  'are', 'was', 'were', 'been', 'being', 'will', 'would', 'can', 'could',
  'may', 'might', 'should', 'must', 'shall', 'does', 'did', 'doing', 'done',
  'not', 'don\'t', 'doesn\'t', 'isn\'t', 'aren\'t', 'won\'t', 'can\'t',
  'it\'s', 'you\'re', 'you\'ve', 'you\'ll', 'that\'s', 'there\'s',
  'more', 'most', 'less', 'least', 'very', 'much', 'many', 'some', 'any',
  'all', 'each', 'both', 'few', 'own', 'same', 'other', 'another', 'such',
  'just', 'also', 'even', 'still', 'only', 'often', 'sometimes', 'usually',
  'tend', 'tends', 'seem', 'seems', 'feel', 'feels', 'feeling', 'like',
  'itself', 'because', 'though', 'although', 'rather', 'quite', 'really',
])

/** The substance-bearing words of a page version, as a lowercase set. */
export function contentWords(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z']+/g) ?? []
  const out = new Set<string>()
  for (const t of tokens) {
    const w = t.replace(/^'+|'+$/g, '')
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w)
  }
  return out
}

/**
 * Fraction of `prev`'s content words that survive in `next` (0–1), or null when
 * `prev` carries no content words to retain.
 */
export function retention(prev: string, next: string): number | null {
  const prevWords = contentWords(prev)
  if (prevWords.size === 0) return null
  const nextWords = contentWords(next)
  let kept = 0
  for (const w of prevWords) if (nextWords.has(w)) kept++
  return kept / prevWords.size
}

export interface PageDrift {
  id: string
  title: string
  category: string | null
  /** Total versions including the current one. */
  versions: number
  /** Per-rewrite retention, oldest rewrite first. */
  steps: number[]
  meanStep: number
  minStep: number
  /** Fraction of the first CONTENTFUL version's words still in the current
   *  page — the compounding-loss signal a per-step number can hide. (Engine
   *  pages are created empty, so v1 itself is usually blank.) Null when no
   *  prior version had content words. */
  origin: number | null
}

/** Drift for one page's rewrite chain, or null if it has never been rewritten
 *  (or no rewrite had measurable prior content). */
export function pageDrift(page: WikiPage): PageDrift | null {
  const history = [...page.version_history].sort((a, b) => a.version - b.version)
  if (history.length === 0) return null

  const chain = [...history.map((v) => v.content), page.content]
  const steps: number[] = []
  for (let i = 1; i < chain.length; i++) {
    const r = retention(chain[i - 1], chain[i])
    if (r != null) steps.push(r)
  }
  if (steps.length === 0) return null

  // Engine pages are created with empty content (first synthesis lands as v2),
  // so origin measures from the first version that actually has content words.
  const originBase = chain.slice(0, -1).find((c) => contentWords(c).size > 0)

  return {
    id: page.id,
    title: page.title,
    category: page.category,
    versions: page.version,
    steps,
    meanStep: steps.reduce((a, b) => a + b, 0) / steps.length,
    minStep: Math.min(...steps),
    origin: originBase != null ? retention(originBase, page.content) : null,
  }
}

export interface DriftReport {
  /** Pages with at least one measurable rewrite, drifty (low meanStep) first. */
  pages: PageDrift[]
  pageCount: number
  /** Total measured rewrites across all pages. */
  rewriteCount: number
  /** Mean retention pooled over every rewrite (not per-page averages). */
  meanStep: number
  /** Mean origin retention across pages that have one. */
  meanOrigin: number
}

/** Measure drift across every live wiki page. Read-only; display-only (the
 *  report holds page titles — never log it). */
export async function driftReport(): Promise<Result<DriftReport>> {
  const res = await listPages()
  if (!res.success) return res

  const pages = res.data
    .map(pageDrift)
    .filter((d): d is PageDrift => d != null)
    .sort((a, b) => a.meanStep - b.meanStep)

  const allSteps = pages.flatMap((p) => p.steps)
  const origins = pages.map((p) => p.origin).filter((o): o is number => o != null)
  return ok({
    pages,
    pageCount: pages.length,
    rewriteCount: allSteps.length,
    meanStep: allSteps.length ? allSteps.reduce((a, b) => a + b, 0) / allSteps.length : 0,
    meanOrigin: origins.length ? origins.reduce((a, b) => a + b, 0) / origins.length : 0,
  })
}
