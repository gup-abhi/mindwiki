import { answerFromWiki } from '@/services/llm/deep-model'
import { type WikiPage } from '@/services/storage/wiki'
import { type Result, ok } from '@/types/result'

import { rankPages } from './search'

export interface WikiAnswer {
  answer: string
  /** Pages the answer was grounded in (for source chips). */
  sources: WikiPage[]
  /** Total journal entries behind those pages. */
  evidenceCount: number
}

const NO_MATCH =
  "I couldn't find anything in your wiki about that yet — keep journaling and it'll grow."

const SUGGESTION_TEMPLATES: ((title: string) => string)[] = [
  (t) => `What patterns show up around ${t}?`,
  (t) => `How has ${t} been affecting me?`,
  (t) => `What tends to trigger ${t}?`,
]

/**
 * Suggested questions seeded from the user's richest wiki pages (most entries),
 * varied across a few templates. Pure.
 */
export function suggestedQuestions(pages: WikiPage[], limit = 3): string[] {
  return [...pages]
    .filter((p) => p.entry_count > 0)
    .sort((a, b) => b.entry_count - a.entry_count)
    .slice(0, limit)
    .map((p, i) => SUGGESTION_TEMPLATES[i % SUGGESTION_TEMPLATES.length](p.title))
}

/**
 * Answer a question from the wiki: rank pages, ground the deep model in the top
 * few, and report which pages (and how many entries) backed the answer. When no
 * page matches, returns a friendly message without calling the model.
 */
export async function answerQuestion(
  question: string,
  pages: WikiPage[]
): Promise<Result<WikiAnswer>> {
  const sources = rankPages(question, pages, 3).map((r) => r.page)
  if (sources.length === 0) {
    return ok({ answer: NO_MATCH, sources: [], evidenceCount: 0 })
  }

  const res = await answerFromWiki({
    question,
    sources: sources.map((p) => ({ title: p.title, content: p.content })),
  })
  if (!res.success) return res

  const evidenceCount = sources.reduce((n, p) => n + p.entry_count, 0)
  return ok({ answer: res.data, sources, evidenceCount })
}
