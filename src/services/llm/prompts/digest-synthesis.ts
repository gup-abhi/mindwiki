export interface DigestSynthesisInput {
  focus: string[]
  entries: { situation: string; thought: string; emotion: string | null }[]
  pages: { title: string; content: string }[]
}

/**
 * Instruction for the deep model to synthesize the user's past week from ONLY
 * their own material (journal entries + wiki pages). Grounded — must not invent
 * beyond the material. On-device only. Asks for strict JSON the analyst parses.
 */
export function buildDigestSynthesisPrompt({
  focus,
  entries,
  pages,
}: DigestSynthesisInput): string {
  const entryCtx = entries
    .map(
      (e, i) =>
        `[E${i + 1}] ${e.situation} — ${e.thought}${e.emotion ? ` (${e.emotion})` : ''}`
    )
    .join('\n')
  const pageCtx = pages.map((p, i) => `[W${i + 1}] ${p.title}\n${p.content}`).join('\n\n')

  return [
    "Synthesize the user's past week using ONLY the material below (their own",
    'journal entries and wiki pages). Identify recurring themes, behavioral or',
    'cognitive patterns, and open questions worth reflecting on. Be warm,',
    'concise, and specific. Do NOT invent anything beyond the material. Do not',
    'diagnose or give medical advice.',
    '',
    focus.length ? `This week centered on: ${focus.join(', ')}.` : '',
    '',
    'Entries:',
    entryCtx,
    '',
    'Wiki pages:',
    pageCtx || '(none)',
    '',
    'Respond with ONLY JSON of this exact shape:',
    '{"themes":["..."],"patterns":["..."],"openQuestions":["..."]}',
    'Each array holds 1–4 short items.',
  ].join('\n')
}
