import { z } from 'zod'

// Fast-model output for a journal entry. Validated before use — a failed parse
// must never block the entry save (ADR 004).
export const EntryTagSchema = z.object({
  emotion: z.string().min(1),
  distortion: z.string().min(1), // 'none' when no distortion is present
  mood_score: z.number().min(0).max(1), // 0 = very negative … 1 = very positive
})

export type EntryTag = z.infer<typeof EntryTagSchema>
