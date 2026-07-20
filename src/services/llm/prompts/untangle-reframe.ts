export interface UntangleReframePromptInput {
  thought: string
  patterns: readonly string[]
  sources: { title: string; excerpt: string }[]
}

// Keep this prompt well below the deep model's 2,048-token context after ChatML
// wrapping. The 3B model is more reliable with a short source window and a
// compact output contract than with a long, heavily-labelled instruction block.
const MAX_THOUGHT_CHARS = 400
const MAX_SOURCE_CHARS = 180
const MAX_SOURCES = 2

function compact(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/**
 * Deep-model instruction: generate three short balanced alternatives. It gives
 * the model only compact, direct wiki evidence and a simple labelled output
 * contract. Runs on-device only; no thought or source text leaves the device.
 */
export function buildUntangleReframePrompt(input: UntangleReframePromptInput): string {
  const patterns = input.patterns.length
    ? input.patterns.slice(0, 2).join(', ')
    : 'none selected'
  const evidence = input.sources
    .slice(0, MAX_SOURCES)
    .map((source) => `- ${compact(source.excerpt, MAX_SOURCE_CHARS)}`)
    .join('\n')

  return [
    'Offer three brief, balanced first-person alternatives to this difficult thought.',
    'Use evidence only if it is supplied. Do not diagnose, invent events, claim to know other minds, or force positivity.',
    'Each line must be a complete sentence under 120 characters.',
    'Write exactly three lines. Prefix them factual:, gentle:, and action:, then write a real sentence after each colon.',
    'Do not use placeholders, brackets, or ellipses.',
    '',
    `thought: ${compact(input.thought, MAX_THOUGHT_CHARS)}`,
    `patterns: ${patterns}`,
    evidence ? `evidence:\n${evidence}` : 'evidence: none',
  ].join('\n')
}
