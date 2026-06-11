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
  /** Rolling recap of earlier turns that fell out of the recent window. */
  summary?: string
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
  '- Don’t end every reply with a question. Most of the time, simply reflect back,',
  '  validate, or share an observation. Ask a gentle, open question only now and',
  '  then, when it would genuinely help them go deeper — never more than one.',
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
  summary,
}: BuildConversationInput): ChatMessage[] {
  // A long thread is trimmed to the recent turns; the recap stands in for the
  // earlier ones so the companion keeps continuity without blowing the context.
  const recap = summary && summary.trim()
    ? `${SYSTEM}\n\n— Earlier in this conversation (recap of what came before the messages below) —\n${summary.trim()}`
    : SYSTEM
  const userTurn = `${message}${backgroundBlock(context)}`
  return [{ role: 'system', content: recap }, ...history, { role: 'user', content: userTurn }]
}

const SUMMARY_SYSTEM = [
  'You maintain a running recap of a reflective conversation so it can continue',
  'after older messages scroll out of view. Update the recap to include the new',
  'messages, merging them with the summary so far.',
  '',
  'Keep it under 120 words. Write plain, factual notes about the user: what they',
  'shared, how they felt, the topics covered, and anything left unresolved. Third',
  'person ("They..."). No advice, no questions, no preamble — output only the',
  'updated recap.',
].join('\n')

export interface BuildSummaryInput {
  /** The recap so far (empty on first summarization). */
  previousSummary: string
  /** The newly-evicted turns to fold into the recap, oldest first. */
  turns: ChatMessage[]
}

/** Build the message array that asks the model to extend the rolling recap. */
export function buildSummaryMessages({ previousSummary, turns }: BuildSummaryInput): ChatMessage[] {
  const body = [
    previousSummary.trim() ? `Recap so far:\n${previousSummary.trim()}` : 'No recap yet.',
    '',
    'New messages to fold in:',
    turns.map((t) => `${t.role === 'user' ? 'User' : 'Companion'}: ${t.content}`).join('\n'),
  ].join('\n')
  return [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: body },
  ]
}
