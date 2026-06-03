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
