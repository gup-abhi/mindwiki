import { generateReflectionQuestion } from '@/services/llm/deep-model'

import { type Digest } from './generator'

/**
 * Best-effort: replace the digest's templated question with an LLM-generated
 * one. Falls back to the template on any failure — never throws, never blocks.
 */
export async function enrichWithQuestion(digest: Digest): Promise<Digest> {
  const res = await generateReflectionQuestion({
    pattern: digest.pattern,
    correlation: digest.correlation,
  })
  return res.success ? { ...digest, question: res.data } : digest
}
