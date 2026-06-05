import { type Digest } from '@/services/digest/generator'
import { type Entry } from '@/services/storage/entries'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'

import { analyze } from './analyst'
import { critique } from './critic'
import { gatherMaterial } from './retriever'

export interface SynthesisInput {
  digest: Digest
  entries: Entry[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  pages: WikiPage[]
}

const MAX_ANALYST_ATTEMPTS = 2

/**
 * Orchestrate the multi-agent digest synthesis: retriever (pure) → analyst (deep
 * model, retried on validation failure) → critic (pure claim-check). Best-effort
 * and additive — on any failure the digest is returned unchanged (no synthesis),
 * never throwing and never blocking the digest (ADR 004).
 */
export async function runDigestSynthesis({
  digest,
  entries,
  nodes,
  edges,
  pages,
}: SynthesisInput): Promise<Digest> {
  const material = gatherMaterial(entries, nodes, edges, pages)
  if (material.entries.length === 0) return digest

  for (let attempt = 0; attempt < MAX_ANALYST_ATTEMPTS; attempt++) {
    const res = await analyze(material)
    if (!res.success) continue

    const { synthesis, flaggedClaims } = critique(res.data, material.entries)
    // Nothing survived the critic — retry rather than surface an empty synthesis.
    if (synthesis.themes.length === 0 && synthesis.patterns.length === 0) continue

    return { ...digest, synthesis: { ...synthesis, flaggedClaims } }
  }

  return digest
}
