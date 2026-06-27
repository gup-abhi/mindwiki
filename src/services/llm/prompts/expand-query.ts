/**
 * Fast-model instruction: generate a few alternate keywords/phrasings for a
 * Reflect message, to widen lexical retrieval over the user's wiki (a message
 * and the page about its theme often use different words). Output is a single
 * JSON object — tiny and fast. Runs on-device only; the message never leaves
 * the device and is never logged.
 */
export function buildExpandQueryPrompt(message: string): string {
  return [
    'You read a short journal message and output ONLY a JSON object — no prose, no markdown.',
    'Schema: {"keywords": string[]}',
    '- List 2-3 short keywords or alternate phrasings that capture the message’s themes and',
    '  feelings, to help search a personal journal. Single words or short phrases.',
    '- Use plain, everyday words the writer might also use. No explanations, no sentences.',
    '',
    `Message: ${message}`,
    '',
    'JSON:',
  ].join('\n')
}
