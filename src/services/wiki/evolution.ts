import { type WikiPage } from '@/services/storage/wiki'
import { retention, contentWords } from '@/services/wiki/drift'

/**
 * Evolution view for a single wiki page: unwraps version_history into a browsable
 * timeline of snapshots, computes word-level diffs between any two versions, and
 * measures retention per step. Pure functions over existing persisted data — zero
 * new schema. The view that proves the AI's understanding compounds over time.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvolutionVersion {
  version: number
  content: string
  updated_at: number
}

export interface EvolutionData {
  title: string
  category: string | null
  /** Archived versions, oldest-first. Not including the current one. */
  versions: EvolutionVersion[]
  /** The page's live content — the newest snapshot. */
  current: EvolutionVersion
  totalEntryCount: number
  createdAt: number
  updatedAt: number
}

export type DiffType = 'same' | 'added' | 'removed'

export interface DiffToken {
  text: string
  type: DiffType
}

export interface VersionRetention {
  version: number
  stepRetention: number | null
  originRetention: number | null
}

// ---------------------------------------------------------------------------
// Timeline assembly
// ---------------------------------------------------------------------------

/**
 * Unwrap the version_history into an ordered timeline. Oldest version first,
 * current version last.
 */
export function pageEvolution(page: WikiPage): EvolutionData {
  const sorted = [...page.version_history].sort((a, b) => a.version - b.version)

  const versions: EvolutionVersion[] = sorted.map((v) => ({
    version: v.version,
    content: v.content,
    updated_at: v.updated_at,
  }))

  return {
    title: page.title,
    category: page.category,
    versions,
    current: {
      version: page.version,
      content: page.content,
      updated_at: page.updated_at,
    },
    totalEntryCount: page.entry_count,
    createdAt: page.created_at,
    updatedAt: page.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Word-level diff  (LCS, no dependencies)
// ---------------------------------------------------------------------------

/**
 * Tokenize text into words/punctuation/whitespace tokens. Splits on word
 * boundaries so the diff operates on individual words while preserving
 * formatting around them.
 */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean)
}

/**
 * Word-level diff between two content strings using LCS. Returns an ordered
 * list of fragments, each tagged as 'same' (in both), 'added' (only in b),
 * or 'removed' (only in a). Adjacent fragments of the same type are merged.
 */
export function wordDiff(a: string, b: string): DiffToken[] {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  const m = tokensA.length
  const n = tokensB.length

  // LCS table — O(mn) on word tokens, fine for short wiki page content
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        tokensA[i - 1] === tokensB[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack through the table to build the diff (in reverse)
  const reversed: DiffToken[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
      reversed.push({ text: tokensA[i - 1], type: 'same' })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ text: tokensB[j - 1], type: 'added' })
      j--
    } else {
      reversed.push({ text: tokensA[i - 1], type: 'removed' })
      i--
    }
  }

  // Reverse back to source order and merge adjacent same-type fragments
  const raw = reversed.reverse()
  const merged: DiffToken[] = []
  for (const t of raw) {
    const last = merged[merged.length - 1]
    if (last && last.type === t.type) {
      last.text += t.text
    } else {
      merged.push({ text: t.text, type: t.type })
    }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Retention metrics per version (reuses drift.ts helpers)
// ---------------------------------------------------------------------------

/**
 * Retention for each version in the chain: the fraction of the prior version's
 * content words that survived (step), and of the first contentful version's
 * words still present (origin). Null when there's nothing to measure from.
 */
export function retentionAtVersions(evo: EvolutionData): VersionRetention[] {
  const chain = [...evo.versions, evo.current]
  const out: VersionRetention[] = []

  // Find the first version with actual content words (skip empty v1 shells)
  const firstContentful = chain.findIndex(
    (v) => contentWords(v.content).size > 0
  )
  const originContent = firstContentful >= 0 ? chain[firstContentful].content : null

  for (let i = 0; i < chain.length; i++) {
    const prev = i > 0 ? chain[i - 1].content : null
    const next = chain[i].content
    out.push({
      version: chain[i].version,
      stepRetention: prev != null ? retention(prev, next) : null,
      originRetention:
        originContent != null && i >= firstContentful
          ? retention(originContent, next)
          : null,
    })
  }

  return out
}
