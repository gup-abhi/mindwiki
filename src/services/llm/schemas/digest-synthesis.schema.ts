import { z } from 'zod'

// Deep-model synthesis for the weekly digest — bounded lists of short lines.
// Validated before use; a failed parse must never block the digest (ADR 004).
const line = z.string().trim().min(1).max(200)

export const DigestSynthesisSchema = z.object({
  themes: z.array(line).min(1).max(4),
  patterns: z.array(line).min(1).max(4),
  openQuestions: z.array(line).min(1).max(4),
})

export type DigestSynthesis = z.infer<typeof DigestSynthesisSchema>
