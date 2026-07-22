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

/** A detected gap in the version chain (sampled history). Versions with these
 *  version numbers were discarded by the engine's retained-history cap, so the
 *  retained versions on either side of the gap were NOT consecutive rewrites.
 *  Step retention is NOT calculated across a gap. */
export interface SampledGap {
  fromVersion: number
  toVersion: number
  /** How many version numbers are missing inside the gap (e.g. 11 for v2 ↔ v14). */
  missing: number
}

/** A validation issue detected while normalizing the version chain before
 *  computing retention. Reports MUST still render with these — the chain is
 *  best-effort normalised (dedup + sort) — but the issue is surfaced so the
 *  report doesn't silently mislead. `detail` is a sanitized human string; it
 *  never contains page text or titles. */
export interface VersionIssue {
  type: 'duplicate-version' | 'non-increasing-timestamp'
  version: number
  detail: string
}

export interface PageDrift {
  id: string
  title: string
  category: string | null
  /** Total version number of the current page (not the count of retained
   *  versions — the retained-history cap may have discarded intermediate ones). */
  versions: number
  /** Per-rewrite WORD-OVERLAP retention, oldest-first. Only computed across
   *  ADJACENT version numbers (no gap): a v2 → v14 sampled interval contributes
   *  no entry here. Honest `steps.length` therefore may be less than the number
   *  of rewrites the page actually had. The label on every number in this report
   *  is lexical/word-overlap, never semantic understanding. */
  steps: number[]
  meanStep: number
  minStep: number
  /** Sampled-history gaps in the retained chain, oldest-first. Empty when the
   *  retained chain is fully consecutive (v1, v2, v3, …). */
  gaps: SampledGap[]
  /** Validation issues found while normalising the chain. The metric still
   *  renders using the cleaned chain; the issues are surfaced so duplication or
   *  clock-skew can't silently masquerade as drift. Empty when the chain is clean. */
  issues: VersionIssue[]
  /** Fraction of the first CONTENTFUL version's words still in the current
   *  page — the compounding-loss signal a per-step number can hide. (Engine
   *  pages are created empty, so v1 itself is usually blank.) Null when no
   *  retained version had content words. Origin IGNORES gaps — it measures a
   *  direct v_first_contentful → v_current word overlap, even when the chain in
   *  between was sampled down. */
  origin: number | null
}

/** Normalise + validate the retained version chain before any retention math:
 *  sort by version, detect duplicate version numbers, detect non-increasing
 *  timestamps, and detect version-number gaps caused by the retained-history
 *  sampling cap. The returned `versions` is the cleaned, sorted chain with
 *  duplicates dropped (the last one wins, as a stable remove-duplicate-by-key).
 *  Pure, deterministic, throws on nothing. */
export function normalizeVersionChain(
  history: { version: number; content: string; updated_at: number }[]
): {
  versions: { version: number; content: string; updated_at: number }[]
  gaps: SampledGap[]
  issues: VersionIssue[]
} {
  const issues: VersionIssue[] = []
  // Deduplicate by version number (last write wins) BEFORE sorting, so a
  // duplicate version number never appears in the cleaned chain.
  const byVersion = new Map<number, { version: number; content: string; updated_at: number }>()
  for (const v of history) {
    if (byVersion.has(v.version)) {
      issues.push({
        type: 'duplicate-version',
        version: v.version,
        detail: `duplicate version #${v.version} in retained history; keeping the latest write`,
      })
    }
    byVersion.set(v.version, v)
  }
  const deduped = [...byVersion.values()].sort((a, b) => a.version - b.version)

  // Non-increasing timestamps: a later version should not predate an earlier one.
  for (let i = 1; i < deduped.length; i++) {
    if (deduped[i].updated_at < deduped[i - 1].updated_at) {
      issues.push({
        type: 'non-increasing-timestamp',
        version: deduped[i].version,
        detail: `version #${deduped[i].version} timestamp predates version #${deduped[i - 1].version}`,
      })
    }
  }

  // Gaps: consecutive retained versions whose numbers differ by more than 1.
  const gaps: SampledGap[] = []
  for (let i = 1; i < deduped.length; i++) {
    const missing = deduped[i].version - deduped[i - 1].version - 1
    if (missing > 0) {
      gaps.push({
        fromVersion: deduped[i - 1].version,
        toVersion: deduped[i].version,
        missing,
      })
    }
  }

  return { versions: deduped, gaps, issues }
}

/** Drift for one page's rewrite chain, or null if it has never been rewritten
 *  (or no rewrite had measurable prior content). Step retention is only computed
 *  across adjacent version numbers — sampled gaps contribute no step. Origin
 *  retention is computed from the first CONTENTFUL retained version to the
 *  current page regardless of gaps. */
export function pageDrift(page: WikiPage): PageDrift | null {
  if (page.version_history.length === 0) return null

  const { versions: chain, gaps: historyGaps, issues } = normalizeVersionChain(page.version_history)
  if (chain.length === 0) return null

  const withCurrent = [...chain, { version: page.version, content: page.content, updated_at: page.updated_at }]

  // The sampled-history gap from the last retained version up to the current
  // version is detected here (normalizeVersionChain only sees version_history,
  // not the live page). When present, the v_lastretained → v_current step is
  // elided — computing it would masquerade several discarding rewrites as one
  // rewrite's word overlap.
  const gaps = [...historyGaps]
  const lastRetained = chain[chain.length - 1]
  const missingToCurrent = page.version - lastRetained.version - 1
  if (missingToCurrent > 0) {
    gaps.push({ fromVersion: lastRetained.version, toVersion: page.version, missing: missingToCurrent })
  }

  // Step retention: ONLY across adjacent version numbers (i.e. NOT across a
  // sampled gap). We pair each retained version with its predecessor only when
  // `prev.version === curr.version - 1`; otherwise the v_prev → v_curr interval
  // spanned discarded rewrites and a step here would masquerade as a single
  // rewrite's word overlap.
  const steps: number[] = []
  for (let i = 1; i < withCurrent.length; i++) {
    const prev = withCurrent[i - 1]
    const curr = withCurrent[i]
    if (curr.version - prev.version !== 1) continue // sampled gap — no step here
    const r = retention(prev.content, curr.content)
    if (r != null) steps.push(r)
  }
  if (steps.length === 0) {
    // Even when no measurable adjacent step survived, surface the page so the
    // report can flag its gaps/issues. Origin can be non-null and informative
    // even when every step was elided by sampling (one big retained interval).
    if (gaps.length === 0 && issues.length === 0) return null
  }

  // Engine pages are created with empty content (first synthesis lands as v2),
  // so origin measures from the first version that actually has content words.
  const originBase = withCurrent.slice(0, -1).find((c) => contentWords(c.content).size > 0)

  return {
    id: page.id,
    title: page.title,
    category: page.category,
    versions: page.version,
    steps,
    meanStep: steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : 0,
    minStep: steps.length ? Math.min(...steps) : 0,
    gaps,
    issues,
    origin: originBase != null ? retention(originBase.content, page.content) : null,
  }
}

export interface DriftReport {
  /** Pages with at least one measurable rewrite, drifty (low meanStep) first. */
  pages: PageDrift[]
  pageCount: number
  /** Total measured rewrites across all pages. */
  rewriteCount: number
  /** Mean retention pooled over every rewrite (not per-page averages). */
  /** Mean WORD-OVERLAP retention pooled over every adjacent rewrite
   *  (sampled gaps contribute no step). Not a measure of semantic
   *  understanding — same words surviving or not is all it tracks. */
  meanStep: number
  /** Mean origin word-overlap across pages that have one. */
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
