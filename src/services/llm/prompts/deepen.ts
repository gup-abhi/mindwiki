export interface DeepenPromptInput {
  /** The guided-path step the user was answering. */
  prompt: string
  /** What the user just wrote in response. */
  answer: string
}

/**
 * Deep-model instruction for the guided-path "go deeper" assist: given the step
 * prompt and the user's answer, produce ONE gentle follow-up question that invites
 * them a layer further. Constrained to ASK, never assert — a question can't
 * fabricate a fact about the writer, which is exactly the failure that made the
 * old auto-generated Pursuits notes untrustworthy. On-device only; the answer
 * never leaves the device.
 */
export function buildDeepenPrompt({ prompt, answer }: DeepenPromptInput): string {
  const lines = [
    'You are a warm, curious reflection companion helping someone go one layer deeper.',
    'They were asked a question and wrote an answer. Respond with ONE gentle follow-up',
    'QUESTION that invites them to explore what they wrote a little further.',
    'Rules:',
    '- Output ONLY the question — one sentence. No preamble, no quotes, no markdown.',
    '- Ask, never assert. Do NOT state facts, motivations, or conclusions about them.',
    '- Stay close to what they actually wrote; never invent details they did not mention.',
    '- Be warm and open, not clinical or leading.',
    '',
    `They were asked: ${prompt}`,
    `They wrote: ${answer}`,
    '',
    'Your one follow-up question:',
  ]
  return lines.join('\n')
}
