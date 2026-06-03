import { type WikiPage } from '@/services/storage/wiki'

export interface RankedPage {
  page: WikiPage
  score: number
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
    if (score > 0) {
      score += Math.min(page.entry_count, 10) * 0.1 // gentle richness boost
      ranked.push({ page, score })
    }
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit)
}
