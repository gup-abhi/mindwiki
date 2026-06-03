import { z } from 'zod'

// A grounded wiki answer — non-empty, bounded to a few sentences.
export const AnswerSchema = z.string().trim().min(1).max(800)

export type Answer = z.infer<typeof AnswerSchema>
