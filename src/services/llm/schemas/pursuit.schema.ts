import { z } from 'zod'

// The deep-model running note for a pursuit (what it is / why it matters / where
// it stands). Plain prose, non-empty, bounded — a few sentences, not a page.
export const PursuitDetailsSchema = z.string().trim().min(1).max(800)

export type PursuitDetails = z.infer<typeof PursuitDetailsSchema>
