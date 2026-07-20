import { z } from 'zod'

// Raw output from the fast model: zero-to-some candidate labels. The wrapper
// canonicalizes, dedupes, drops unknowns, and caps to 2 — so the schema is
// generous and lets the model express candidates freely.
export const UntanglePatternsSchema = z.object({
  patterns: z.array(z.string()).max(8),
})

export type UntanglePatterns = z.infer<typeof UntanglePatternsSchema>
