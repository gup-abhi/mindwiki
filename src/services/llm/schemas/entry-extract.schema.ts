import { z } from 'zod'

// Deep-model extraction for an entry — everything that feeds the knowledge base
// (graph nodes + wiki pages). The deep model (Qwen 3B, KB-grounded) is far more
// consistent than the fast 1.5B at topic + entity extraction, which the
// recurrence gate depends on (inconsistent labels never recur → no node). A
// failed parse must never block the save (ADR 004); the entry just isn't indexed.
export const EntryExtractSchema = z.object({
  emotion: z.string().min(1),
  distortion: z.string().min(1), // 'none' when no distortion is present
  // 0..1 confidence in the distortion call; below threshold the caller drops it.
  distortion_confidence: z.number().min(0).max(1).catch(0),
  mood_score: z.number().min(0).max(1), // 0 = very negative … 1 = very positive
  topic: z.string().min(1), // short concrete theme — routes a wiki page + situation node
  // Concrete entities → entry_entities rows + graph nodes. Tolerant: a bad list
  // never fails the whole extract (ADR 004); it just yields no entities.
  people: z.array(z.string()).default([]).catch([]),
  places: z.array(z.string()).default([]).catch([]),
  activities: z.array(z.string()).default([]).catch([]),
})

export type EntryExtract = z.infer<typeof EntryExtractSchema>
