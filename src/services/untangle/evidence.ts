import { type GraphEdge } from '@/services/storage/graph'
import { type GraphNode } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'
import { rankPages, queryTerms } from '@/services/wiki/search'

// Cap retrieved pages to 2 for the untangle flow.
const MAX_OBSERVATION_PAGES = 2

// The existing Reflect relevance floor.
const MIN_RELEVANCE = 3

// Words and patterns that signal a wiki page contains counterevidence:
// contastive connectives, positive outcomes, coping language, and reframing
// expressions. These are never logged.
const CONTRASTIVE = [
  'but', 'however', 'even though', 'despite', 'although',
  'it was not', 'it wasn\'t', 'was not', 'wasn\'t',
  'not as bad', 'not that bad', 'better than expected',
  'managed to', 'found a way', 'dealt with',
  'helpful', 'worked', 'improved', 'progress', 'better',
  'can be', 'able to', 'try to', 'learned to',
]

export interface Observation {
  pageId: string
  title: string
  excerpt: string
}

export interface ObservationsResult {
  observations: Observation[]
  empty: boolean
}

/** True when the thought expresses a negative self-judgment or catastrophic
 *  prediction — the only case where counterevidence applies. Checks words and
 *  common neg-self patterns deterministically. Pure, no model call. */
function isNegativeThought(text: string): boolean {
  const lower = text.toLowerCase()
  // Strong negative markers
  if (/\b(can't|cannot|won't|will not|never|nobody|nothing|no one|fail|worst|terrible|awful|hate|useless|worthless|hopeless)\b/i.test(lower)) return true
  if (/\bi am (not |too |so |very )?(bad|stupid|dumb|lazy|ugly|fat|failure|loser|inadequate)\b/i.test(lower)) return true
  // Not negative — neutral, positive, or ambiguous
  return false
}

/**
 * Build a counterevidence query from the thought: combine the thought's own
 * content words with contrastive terms so ranking surfaces wiki pages that
 * express exceptions, improvements, or coping outcomes rather than just
 * topically related prose.
 */
function counterQuery(text: string): string {
  const terms = queryTerms(text)
  return [...terms.slice(0, 8), ...CONTRASTIVE.slice(0, 6)].join(' ')
}

/**
 * Build at most two counterevidence observations from existing wiki pages.
 * For **negative** thoughts, the query is expanded with contrastive terms so
 * ranked pages skew toward content that contradicts or softens the thought.
 * For neutral/positive thoughts, falls back to general relevance.
 *
 * Excerpts are direct source text — never LLM summaries. Pure — no model
 * call, no storage write.
 */
export function buildObservations(
  thought: string,
  pages: WikiPage[],
  nodes: GraphNode[],
  edges: GraphEdge[]
): ObservationsResult {
  const isNegative = isNegativeThought(thought)
  // Use a contrastive-biased query for negative thoughts; general relevance otherwise.
  const query = isNegative ? counterQuery(thought) : thought
  const ranked = rankPages(query, pages, MAX_OBSERVATION_PAGES + 1)
  const sources = ranked.filter((r) => r.score >= MIN_RELEVANCE)

  if (sources.length === 0) {
    return { observations: [], empty: true }
  }

  const observations: Observation[] = sources
    .slice(0, MAX_OBSERVATION_PAGES)
    .map((r) => ({
      pageId: r.page.id,
      title: r.page.title,
      excerpt: r.page.content.slice(0, 600),
    }))

  return { observations, empty: false }
}
