import { z } from 'zod'

// A single follow-up question — one line, bounded so a runaway generation can't
// spill a paragraph into the UI. The model is constrained to ASK, never assert
// (see buildDeepenPrompt); this is an optional assist, always skippable.
export const DeepenQuestionSchema = z.string().trim().min(1).max(240)

export type DeepenQuestion = z.infer<typeof DeepenQuestionSchema>
