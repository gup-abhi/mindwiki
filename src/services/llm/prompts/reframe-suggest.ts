export interface ReframePromptInput {
  belief: string
  evidenceFor?: string | null
  evidenceAgainst?: string | null
}

/**
 * Deep-model instruction: suggest ONE balanced, realistic alternative to a harsh
 * belief, grounded in the evidence the user noted (CBT cognitive restructuring).
 * Output is a single short first-person line — the user can edit or replace it.
 * Runs on-device only; the belief + evidence never leave the device.
 */
export function buildReframePrompt({ belief, evidenceFor, evidenceAgainst }: ReframePromptInput): string {
  const lines = [
    'You help someone gently challenge a harsh belief using CBT (cognitive restructuring).',
    'Output ONLY one balanced, realistic alternative thought: a single short sentence in the',
    'first person ("I ..."). No preamble, no list, no quotes, no markdown.',
    'It must be honest and grounded in the evidence — not toxic positivity, not dismissive.',
    '',
    `The belief: ${belief}`,
    `Evidence the writer noted FOR it: ${evidenceFor?.trim() || '(none given)'}`,
    `Evidence the writer noted AGAINST it: ${evidenceAgainst?.trim() || '(none given)'}`,
    '',
    'Balanced thought:',
  ]
  return lines.join('\n')
}
