import { z } from 'zod'

// A grounded conversational reply — non-empty. The ceiling must stay above what
// the model can actually generate (maxTokens 220 ≈ 900–1100 chars); otherwise a
// long-but-valid reply is rejected *after* it has already streamed to the user,
// surfacing as a spurious "something went wrong". Generation length is bounded at
// the source by maxTokens — this cap is only a sanity guard against runaway output.
export const ConversationReplySchema = z.string().trim().min(1).max(2000)

export type ConversationReply = z.infer<typeof ConversationReplySchema>

// A rolling recap of earlier turns — non-empty. Same rule: keep the ceiling above
// the summary's generation budget (maxTokens 200 ≈ ~800 chars) so a valid recap is
// never rejected.
export const ConversationSummarySchema = z.string().trim().min(1).max(1200)

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>
