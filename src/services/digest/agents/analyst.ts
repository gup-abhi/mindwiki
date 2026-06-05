import { synthesizeDigest } from '@/services/llm/deep-model'
import { type DigestSynthesis } from '@/services/llm/schemas/digest-synthesis.schema'
import { type Result } from '@/types/result'

import { type DigestMaterial } from './retriever'

/**
 * Analyst agent: ask the deep model to synthesize themes / patterns / open
 * questions from the retriever's material. Maps the material to the prompt input
 * and delegates inference + Zod validation to synthesizeDigest. Returns Result.
 */
export function analyze(material: DigestMaterial): Promise<Result<DigestSynthesis>> {
  return synthesizeDigest({
    focus: material.focus,
    entries: material.entries.map((e) => ({
      situation: e.situation,
      thought: e.thought,
      emotion: e.emotion,
    })),
    pages: material.pages.map((p) => ({ title: p.title, content: p.content })),
  })
}
