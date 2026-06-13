import { z } from 'zod'

// The deep-model running note for a pursuit (what it is / why it matters / where
// it stands). Plain prose, non-empty, bounded — a few sentences, not a page.
export const PursuitDetailsSchema = z.string().trim().min(1).max(800)

export type PursuitDetails = z.infer<typeof PursuitDetailsSchema>

// A single check-in question — non-empty, bounded to one short sentence.
export const CheckinQuestionSchema = z.string().trim().min(1).max(200)

export type CheckinQuestion = z.infer<typeof CheckinQuestionSchema>
