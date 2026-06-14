import { z } from 'zod'

// A single completion affirmation — first-person, one short line, bounded so a
// runaway generation can't land a paragraph on the cover screen.
export const AffirmationSchema = z.string().trim().min(1).max(160)

export type Affirmation = z.infer<typeof AffirmationSchema>
