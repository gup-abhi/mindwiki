import { z } from 'zod'

// A single reflection question — non-empty, bounded to one short sentence.
export const ReflectionQuestionSchema = z.string().trim().min(1).max(200)

export type ReflectionQuestion = z.infer<typeof ReflectionQuestionSchema>
