import { z } from 'zod'

// Deep-model output: three short first-person alternatives for the Reframe step.
// Each is validated as a short sentence (≤120 chars), non-empty, and distinct
// from the other two — the wrapper rejects on any violation and returns a
// coded error so the caller retries or shows unavailable.

const REFRAME_MAX_LENGTH = 120

const Candidate = z
  .string()
  .min(1)
  .max(REFRAME_MAX_LENGTH)
  .refine((value) => !/^(?:\.{3}|…|\[.*\])$/.test(value.trim()), {
    message: 'Candidate must not be a placeholder',
  })

export const UntangleReframeSchema = z
  .object({
    factual: Candidate,
    gentle: Candidate,
    action: Candidate,
  })
  .refine((d) => d.factual !== d.gentle && d.factual !== d.action && d.gentle !== d.action, {
    message: 'All three candidates must be distinct',
  })

export type UntangleReframe = z.infer<typeof UntangleReframeSchema>
