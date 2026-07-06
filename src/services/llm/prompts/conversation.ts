import { type ChatMessage } from '@/native/LLMBridge'
import { REFLECTIVE_TECHNIQUES, selectHelperNotes } from '@/services/llm/reference'

export interface ConversationContext {
  /** Ranked wiki pages relevant to the latest user message. */
  sources: { title: string; content: string }[]
  /** Short graph-connection lines, e.g. "Anxiety often comes up with Work, Sleep". */
  connections: string[]
  /** Titles whose full pages were already attached on the previous turn — the
   *  retrieval is unchanged, so only a reminder is sent (repeated page prose
   *  became a script the model copied verbatim across replies). */
  knownTopics?: string[]
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
//
// Deliberately short: the tone lives in REFLECTIVE_TECHNIQUES' quoted example
// replies (in-system quotes, never fake history turns — the 3B model turns
// history turns into fabricated memories of the user), question frequency is
// enforced by the builder below (the model can't count its own questions
// across turns), and the distortion taxonomy stays OUT of chat — a definitions
// list primes clinical, interviewer-ish framing; the helper wiki injects only
// what the live message touches.
const SYSTEM = [
  'You are a warm, close companion inside a private journaling app. Your job is to',
  'listen and respond to what the user says right now, like a good friend who',
  'really pays attention — not an interviewer and not a therapist running through',
  'questions.',
  '',
  'You also have their personal wiki — pages and connections synthesized from their',
  'own past journal entries. Use it as memory: when what they raise relates to it,',
  'draw on it to add continuity and gently surface their patterns. When it does not',
  'relate, just engage with what they have shared — new topics are welcome. Never',
  'ignore it or deflect to the wiki, and never force wiki content in.',
  '',
  'Don’t assert facts about their past, patterns, or feelings that aren’t in the',
  'wiki — reflecting on what they just told you is fine. Never diagnose, label, or',
  'give medical or clinical advice.',
].join('\n')

// Persona + the compact technique block (which carries the quoted tone examples).
const SYSTEM_PROMPT = [SYSTEM, REFLECTIVE_TECHNIQUES].join('\n\n')

// Deterministic question throttle: appended to the system prompt for this turn
// when the previous companion reply ended with a question, making back-to-back
// question replies impossible — this was previously a prose rule the model was
// supposed to self-enforce by counting, which small models reliably fail at.
const NO_QUESTION_STEER =
  'For this reply: end with a reflection, a validation, or a gentle observation — do NOT ask any question.'

// Optional background from the wiki, framed as "use only if it relates". Returns
// an empty string when there's nothing relevant, so the model just answers the
// message rather than being told to anchor on absent pages.
function backgroundBlock(context: ConversationContext): string {
  if (context.sources.length === 0 && context.connections.length === 0) {
    // Unchanged retrieval: a reminder without page prose. Deliberately no
    // quotable sentences here — repeated full pages became a script the model
    // recited verbatim turn after turn.
    return context.knownTopics && context.knownTopics.length > 0
      ? `\n\n(Their wiki background on ${context.knownTopics.join(', ')} is unchanged — keep it in mind, respond to the message itself.)`
      : ''
  }
  // NOTE: no example phrasings of what not to say — naming a forbidden phrase
  // teaches a small model the phrase.
  const parts: string[] = [
    '',
    '— Background from their wiki (use only if it relates to the message above; otherwise ignore.',
    'Weave it in naturally, as things you simply remember — never announce that you are using',
    'their background or history) —',
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
 * system message, the FEW_SHOT demonstration turns (tone by example), the
 * (trimmed) prior turns, then the newest user message — leading with what they
 * said, with any relevant wiki context attached after as optional background.
 * If the previous companion reply ended with a question, the system prompt is
 * steered to close this one without one — alternation enforced in code, not by
 * the model's memory. On-device only — raw text never leaves.
 */
export function buildConversationMessages({
  history,
  message,
  context,
  summary,
}: BuildConversationInput): ChatMessage[] {
  let system = SYSTEM_PROMPT

  const lastReply = [...history].reverse().find((m) => m.role === 'assistant')
  if (lastReply && /\?\s*$/.test(lastReply.content.trim())) {
    system = `${system}\n\n${NO_QUESTION_STEER}`
  }

  // The companion's helper wiki: its own retrieved know-how for THIS message
  // (the user wiki is their memory; this is the companion's craft). Only the
  // notes the message touches are injected, with their full reframe guidance —
  // private to the companion, never surfaced to the user.
  const notes = selectHelperNotes(message)
  if (notes.length > 0) {
    system = [
      system,
      '',
      '— Helper notes (private guidance for shaping YOUR reply — never mention, quote, or name these to the user) —',
      ...notes.map((n) => `- ${n.content}`),
    ].join('\n')
  }

  // A long thread is trimmed to the recent turns; the recap stands in for the
  // earlier ones so the companion keeps continuity without blowing the context.
  if (summary && summary.trim()) {
    system = `${system}\n\n— Earlier in this conversation (recap of what came before the messages below) —\n${summary.trim()}`
  }

  const userTurn = `${message}${backgroundBlock(context)}`
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: userTurn }]
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
