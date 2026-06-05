import { type DigestSynthesis } from '@/services/llm/schemas/digest-synthesis.schema'
import { type Entry } from '@/services/storage/entries'
import { queryTerms, rankEntries } from '@/services/wiki/search'

export interface Critique {
  /** Synthesis with unsupported claims removed. */
  synthesis: DigestSynthesis
  /** Claims dropped because no source entry backs them. */
  flaggedClaims: string[]
}

/**
 * Critic agent (no LLM): check each analyst claim against the source entries. A
 * theme/pattern is kept only when its terms actually appear in some entry;
 * unsupported claims are dropped and listed in flaggedClaims. Open questions are
 * prompts, not assertions, so they are always kept. Pure.
 */
export function critique(synthesis: DigestSynthesis, entries: Entry[]): Critique {
  const flagged: string[] = []

  const supported = (claim: string): boolean =>
    queryTerms(claim).length > 0 && rankEntries(claim, entries, 1).length > 0

  const keep = (claims: string[]): string[] =>
    claims.filter((c) => {
      if (supported(c)) return true
      flagged.push(c)
      return false
    })

  return {
    synthesis: {
      themes: keep(synthesis.themes),
      patterns: keep(synthesis.patterns),
      openQuestions: synthesis.openQuestions,
    },
    flaggedClaims: flagged,
  }
}
