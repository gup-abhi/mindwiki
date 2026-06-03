export interface AnswerQuestionInput {
  question: string
  sources: { title: string; content: string }[]
}

/**
 * Instruction for the deep model to answer the user's question using ONLY their
 * own wiki pages (synthesized from their journal). Grounded — must not invent
 * beyond the pages, and says so when they don't cover it. On-device only.
 */
export function buildAnswerQuestionPrompt({ question, sources }: AnswerQuestionInput): string {
  const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.content}`).join('\n\n')
  return [
    "Answer the user's question using ONLY the personal wiki pages below, which",
    "were synthesized from their own journal. Be concise (2–4 sentences), warm,",
    'and specific. Do NOT invent anything beyond these pages. If they do not',
    "address the question, say you don't have enough in the wiki yet. Do not",
    'diagnose or give medical advice. Output only the answer.',
    '',
    'Wiki pages:',
    ctx,
    '',
    `Question: ${question}`,
    '',
    'Answer:',
  ].join('\n')
}
