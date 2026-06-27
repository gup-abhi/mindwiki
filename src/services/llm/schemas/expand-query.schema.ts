import { z } from 'zod'

// Fast-model output for query expansion: a few alternate keywords/phrasings for a
// Reflect message, unioned into the lexical ranking query so retrieval catches
// pages that use different words. Best-effort — a failed parse just means "no
// expansion" (graph + embedding retrieval still run). On-device only.
export const ExpandQuerySchema = z.object({
  keywords: z.array(z.string()).max(8),
})

export type ExpandQuery = z.infer<typeof ExpandQuerySchema>
