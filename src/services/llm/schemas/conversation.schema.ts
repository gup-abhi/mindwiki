import { z } from 'zod'

// A grounded conversational reply — non-empty, bounded to a few sentences.
export const ConversationReplySchema = z.string().trim().min(1).max(800)

export type ConversationReply = z.infer<typeof ConversationReplySchema>

// A rolling recap of earlier turns — non-empty, kept short so it fits alongside
// the recent window in the model's context budget.
export const ConversationSummarySchema = z.string().trim().min(1).max(700)

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>
