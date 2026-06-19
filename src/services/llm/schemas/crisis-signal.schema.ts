import { z } from 'zod'

// Fast-model output: the ONE signal that must be synchronous — a crisis/self-harm
// likelihood, fed to the crisis detector the instant an entry is saved. Everything
// else (emotion, distortion, topic, entities, mood) moved to the deep model. A
// failed parse must never block the save (ADR 004); the keyword net still fires.
export const CrisisSignalSchema = z.object({
  crisis_confidence: z.number().min(0).max(1),
})

export type CrisisSignal = z.infer<typeof CrisisSignalSchema>
