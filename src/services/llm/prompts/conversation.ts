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

// Reflective companion. Therapist-*style* interaction: it engages with whatever
// the user raises, and draws on their wiki as memory when relevant — but it must
// not diagnose/treat, and must not fabricate facts about their past that aren't
// in the wiki. Responding to what they just said is NOT fabrication.
const SYSTEM = [
  'You are a warm, reflective companion inside a private journaling app. Your job',
  'is to listen and respond to what the user says right now, and help them reflect.',
  '',
  'You also have their personal wiki — pages and connections synthesized from their',
  'own past journal entries. Use it as memory: when what they raise relates to it,',
  'draw on it to add continuity and gently surface their patterns. When it does not',
  'relate, or there is nothing relevant, just engage with what they have shared —',
  'people bring up new things the wiki has not captured yet, and that is welcome.',
  '',
  'Rules:',
  '- Always respond to the user’s latest message. Never ignore it or deflect to',
  '  the wiki. New topics are welcome — explore them with them.',
  '- Be warm, concise (2–4 sentences), and specific to what they actually said.',
  '- Use the wiki only when it genuinely relates to the message; otherwise ignore it.',
  '  Do NOT force wiki content in.',
  '- Don’t assert facts about their past, patterns, or feelings that aren’t in the',
  '  wiki. Reflecting on what they just told you is fine — that is not inventing.',
  '- You may ask one gentle, open question to help them go deeper.',
  '- Never diagnose, label, or give medical or clinical advice.',
].join('\n')

// Optional background from the wiki, framed as "use only if it relates". Returns
// an empty string when there's nothing relevant, so the model just answers the
// message rather than being told to anchor on absent pages.
function backgroundBlock(context: ConversationContext): string {
  if (context.sources.length === 0 && context.connections.length === 0) return ''
  const parts: string[] = [
    '',
    '— Background from their wiki (use only if it relates to the message above; otherwise ignore) —',
  ]
  if (context.sources.length > 0) {
    parts.push(
      'Pages:',
      context.sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.content}`).join('\n\n')
    )
  }
  if (context.connections.length > 0) {
    parts.push('Connections:', context.connections.join('\n'))
  }
  return parts.join('\n')
}

/**
 * Build the ChatML message array for one conversational turn: the reflective
 * system message, the (trimmed) prior turns, then the newest user message —
 * leading with what they said, with any relevant wiki context attached after as
 * optional background. On-device only — raw text never leaves.
 */
export function buildConversationMessages({
  history,
  message,
  context,
}: BuildConversationInput): ChatMessage[] {
  const userTurn = `${message}${backgroundBlock(context)}`
  return [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: userTurn }]
}
