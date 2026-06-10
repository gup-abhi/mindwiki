import { z } from 'zod'

// A grounded conversational reply — non-empty, bounded to a few sentences.
export const ConversationReplySchema = z.string().trim().min(1).max(800)

export type ConversationReply = z.infer<typeof ConversationReplySchema>
