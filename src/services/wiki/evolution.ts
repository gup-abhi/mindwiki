import { type WikiPage } from '@/services/storage/wiki'
import {
  retention,
  contentWords,
  normalizeVersionChain,
  type SampledGap,
  type VersionIssue,
} from '@/services/wiki/drift'

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
  /** Gaps and validation issues over the full archived + live chain. */
  gaps: SampledGap[]
  issues: VersionIssue[]
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
  const normalized = normalizeVersionChain(page.version_history, {
    version: page.version,
    content: page.content,
    updated_at: page.updated_at,
  })
  const current = normalized.versions.find((v) => v.version === page.version) ?? {
    version: page.version,
    content: page.content,
    updated_at: page.updated_at,
  }
  const versions: EvolutionVersion[] = normalized.versions
    .filter((v) => v.version !== current.version)
    .map((v) => ({ ...v }))

  return {
    title: page.title,
    category: page.category,
    versions,
    current: { ...current },
    gaps: normalized.gaps,
    issues: normalized.issues,
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
 * Retention for each version in the chain: the fraction of the prior
 * RETAINED version's content words that survived (step — null across a
 * sampled gap, where versions were discarded, or when there is no prior), and
 * of the first contentful version's words still present (origin — null when
 * the start is an empty shell or when not yet reached). Step retention is
 * word-overlap only, never semantic understanding. */
export function retentionAtVersions(evo: EvolutionData): VersionRetention[] {
  const normalized = normalizeVersionChain([...evo.versions, evo.current])
  const chain = normalized.versions
  const out: VersionRetention[] = []

  // Find the first version with actual content words (skip empty v1 shells)
  const firstContentful = chain.findIndex(
    (v) => contentWords(v.content).size > 0
  )
  const originContent = firstContentful >= 0 ? chain[firstContentful].content : null

  for (let i = 0; i < chain.length; i++) {
    const prev = i > 0 ? chain[i - 1] : null
    const next = chain[i].content
    // Step retention ONLY when the prior RETAINED version is one version back —
    // a gap (e.g. v2 → v14) means discarded rewrites in between, and computing
    // a single step there would masquerade several rewrites as one rewrite's
    // word overlap. Across gaps and at i === 0, step retention is null.
    const isAdjacent =
      prev != null && chain[i].version - prev.version === 1
    out.push({
      version: chain[i].version,
      stepRetention: isAdjacent ? retention(prev.content, next) : null,
      originRetention:
        originContent != null && i >= firstContentful
          ? retention(originContent, next)
          : null,
    })
  }

  return out
}
