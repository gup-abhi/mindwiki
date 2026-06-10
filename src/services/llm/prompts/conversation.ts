import { type ChatMessage } from '@/native/LLMBridge'

export interface ConversationContext {
  /** Ranked wiki pages relevant to the latest user message. */
  sources: { title: string; content: string }[]
  /** Short graph-connection lines, e.g. "Anxiety often comes up with Work, Sleep". */
  connections: string[]
}

export interface BuildConversationInput {
  /** Prior turns (user/assistant), oldest first, already trimmed by the caller. */
  history: ChatMessage[]
  /** The newest user message. */
  message: string
  context: ConversationContext
}

// Grounded reflective companion. Therapist-*style* interaction, but it must not
// diagnose or treat, and must not assert anything not present in the supplied
// wiki pages / connections. It may ask gentle reflective questions.
const SYSTEM = [
  'You are a warm, reflective companion inside a private journaling app. You help',
  "the user reflect on their own life using ONLY their personal wiki pages and the",
  'connections below, which were synthesized from their own journal.',
  '',
  'Rules:',
  '- Be warm, concise (2–4 sentences), and specific.',
  '- Ground everything in the provided wiki pages and connections. Do NOT invent',
  '  facts, events, or feelings that are not there.',
  '- You may ask one gentle, open reflective question to help them think — but never',
  '  assert something about them that the wiki does not support.',
  "- If the wiki doesn't cover what they're asking, say you don't have enough in",
  '  their wiki yet, and invite them to reflect or journal more on it.',
  '- Never diagnose, label, or give medical or clinical advice.',
].join('\n')

function contextBlock(context: ConversationContext): string {
  const pages =
    context.sources.length > 0
      ? context.sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.content}`).join('\n\n')
      : '(no relevant wiki pages found)'
  const connections =
    context.connections.length > 0
      ? context.connections.join('\n')
      : '(no notable connections)'
  return ['Wiki pages:', pages, '', 'Connections:', connections].join('\n')
}

/**
 * Build the ChatML message array for one conversational turn: a grounded system
 * message, the (trimmed) prior turns, then the newest user message with its
 * retrieved wiki context attached. On-device only — raw text never leaves.
 */
export function buildConversationMessages({
  history,
  message,
  context,
}: BuildConversationInput): ChatMessage[] {
  const userTurn = [contextBlock(context), '', `User: ${message}`].join('\n')
  return [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: userTurn }]
}
