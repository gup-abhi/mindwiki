import { type WikiPage } from '@/services/storage/wiki'

const SUGGESTION_TEMPLATES: ((title: string) => string)[] = [
  (t) => `What patterns show up around ${t}?`,
  (t) => `How has ${t} been affecting me?`,
  (t) => `What tends to trigger ${t}?`,
]

/**
 * Suggested questions seeded from the user's richest wiki pages (most entries),
 * varied across a few templates. Used as conversation starters. Pure.
 */
export function suggestedQuestions(pages: WikiPage[], limit = 3): string[] {
  return [...pages]
    .filter((p) => p.entry_count > 0)
    .sort((a, b) => b.entry_count - a.entry_count)
    .slice(0, limit)
    .map((p, i) => SUGGESTION_TEMPLATES[i % SUGGESTION_TEMPLATES.length](p.title))
}
