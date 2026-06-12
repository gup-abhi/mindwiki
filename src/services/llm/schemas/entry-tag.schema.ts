import { z } from 'zod'

// Fast-model output for a journal entry. Validated before use — a failed parse
// must never block the entry save (ADR 004).
export const EntryTagSchema = z.object({
  emotion: z.string().min(1),
  distortion: z.string().min(1), // 'none' when no distortion is present
  mood_score: z.number().min(0).max(1), // 0 = very negative … 1 = very positive
  // Transient — used by the crisis detector, not stored on the entry.
  crisis_confidence: z.number().min(0).max(1),
  // Transient — short theme/topic (1-3 words) used to route a wiki page.
  topic: z.string().min(1),
  // Concrete entities → entry_entities rows + graph nodes. Tolerant: a missing
  // or malformed list never fails the whole tag (a bad parse must not block the
  // save — ADR 004); it just yields no entities of that kind.
  people: z.array(z.string()).default([]).catch([]),
  places: z.array(z.string()).default([]).catch([]),
  activities: z.array(z.string()).default([]).catch([]),
  // Transient — a short phrase naming something the writer is actively working
  // on (a goal/project/effort), or '' if none. Feeds the pursuits tracker; a
  // missing/malformed value never fails the tag (ADR 004).
  working_on: z.string().default('').catch(''),
})

export type EntryTag = z.infer<typeof EntryTagSchema>
