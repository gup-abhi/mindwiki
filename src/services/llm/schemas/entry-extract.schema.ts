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
  // 1–2 short concrete themes — each routes a wiki page + situation node.
  // An entry about work stress bleeding into the marriage gets ["Work", "Marriage"]
  // so both pages compound. Tolerant: absent/bad field defaults to [] and the
  // caller skips indexing rather than failing the whole extract (ADR 004).
  topics: z.array(z.string()).default([]).catch([]),
  // Concrete entities → entry_entities rows + graph nodes. Tolerant: a bad list
  // never fails the whole extract (ADR 004); it just yields no entities.
  people: z.array(z.string()).default([]).catch([]),
  places: z.array(z.string()).default([]).catch([]),
  activities: z.array(z.string()).default([]).catch([]),
  // Cognitive signals → entry_entities rows + graph nodes (belief/behavior).
  // Short canonical phrases so they recur (the recurrence gate matches by label).
  // Tolerant like the entity lists: a bad value yields no node, never a failure.
  beliefs: z.array(z.string()).default([]).catch([]),
  behaviors: z.array(z.string()).default([]).catch([]),
  // Explicit Reflect capture gate. Missing/invalid model output fails closed via
  // the false default; punctuation alone never decides self-relevance.
  is_self_relevant: z.boolean().default(false).catch(false),
  // Reflect-only (requested via extractEntry's restate option): the message
  // rewritten as one self-contained statement, so a context-dependent chat
  // fragment ("yeah exactly, and it's worse at night") never grounds a wiki
  // page verbatim. Tolerant: '' when absent/bad — callers fall back to the raw.
  restatement: z.string().default('').catch(''),
})

export type EntryExtract = z.infer<typeof EntryExtractSchema>
