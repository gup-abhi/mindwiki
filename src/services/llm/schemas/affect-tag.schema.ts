import { z } from 'zod'

// Deep-model re-classification of an entry's affect. The deep model (Qwen 3B,
// KB-grounded) is far better than the fast 1.5B at the subtle distortion call,
// so it overrides the fast tag for graph/wiki. A failed parse must never block
// anything (ADR 004) — the caller falls back to the fast tag.
export const AffectTagSchema = z.object({
  emotion: z.string().min(1),
  distortion: z.string().min(1), // 'none' when no distortion is present
  // 0..1 self-reported confidence in the distortion call. Below a threshold the
  // caller drops the distortion to 'none' rather than record a shaky one.
  distortion_confidence: z.number().min(0).max(1).catch(0),
})

export type AffectTag = z.infer<typeof AffectTagSchema>
