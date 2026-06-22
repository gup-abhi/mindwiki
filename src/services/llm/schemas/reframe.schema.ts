import { z } from 'zod'

// A single suggested balanced thought — one short first-person line, bounded so a
// runaway generation can't drop a paragraph into the reframe field. The user can
// always edit or replace it; this is an optional assist, not the source of truth.
export const ReframeSuggestionSchema = z.string().trim().min(1).max(240)

export type ReframeSuggestion = z.infer<typeof ReframeSuggestionSchema>
