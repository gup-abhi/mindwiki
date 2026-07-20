import { LLMBridge } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'
import { canonicalizeDistortion } from '@/services/llm/taxonomy'
import { buildUntanglePatternsPrompt } from '@/services/llm/prompts/untangle-patterns'
import { UntanglePatternsSchema } from '@/services/llm/schemas/untangle-patterns.schema'
import { buildUntangleReframePrompt } from '@/services/llm/prompts/untangle-reframe'
import { UntangleReframeSchema } from '@/services/llm/schemas/untangle-reframe.schema'

// Shared helper: pull the first {...} JSON object from model output.
function extractJson(text: string): unknown {
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  if (open < 0 || close <= open) return undefined
  try {
    return JSON.parse(text.slice(open, close + 1))
  } catch {
    return undefined
  }
}

/**
 * Result of the pattern-suggestion fast-model call. A successful result contains
 * 0–2 canonical distortion labels. Messages never contain thought text.
 */
export interface PatternSuggestion {
  patterns: string[]
}

/**
 * Suggestion input for the reframe deep-model call.
 */
export interface UntangleReframeInput {
  thought: string
  patterns: readonly string[]
  sources: { title: string; excerpt: string }[]
}

/**
 * Three short balanced alternatives for the reframe step.
 */
export interface UntangleReframeCandidates {
  factual: string
  gentle: string
  action: string
}

/**
 * Ask the fast model to suggest CBT pattern labels that might fit a thought.
 * Output is canonicalized and capped to 2. Best-effort: a model/parse failure
 * returns a coded error (no thought text in message), and the caller shows a
 * retry/unavailable state.
 */
export async function suggestUntanglePatterns(thought: string): Promise<Result<PatternSuggestion>> {
  let raw: string
  try {
    const output = await LLMBridge.tag(buildUntanglePatternsPrompt(thought), {
      maxTokens: 40,
      temperature: 0.2,
    })
    raw = output.text
  } catch (e) {
    return err('PATTERN_INFERENCE_FAILED', 'Fast model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) return err('PATTERN_PARSE_FAILED', 'No JSON object found in model output')

  const parsed = UntanglePatternsSchema.safeParse(json)
  if (!parsed.success) return err('PATTERN_VALIDATION_FAILED', 'Pattern output failed schema validation')

  // Canonicalize, dedupe, drop unknowns → 'none' → drop those.
  const seen = new Set<string>()
  const patterns: string[] = []
  for (const rawLabel of parsed.data.patterns) {
    const can = canonicalizeDistortion(rawLabel)
    if (can === 'none') continue
    if (seen.has(can)) continue
    seen.add(can)
    patterns.push(can)
  }

  return ok({ patterns: patterns.slice(0, 2) })
}

/**
 * Ask the deep model to generate three balanced alternatives (factual, gentle,
 * action) for the untangle reframe step. Best-effort: a model/parse/schema
 * failure returns a coded Result (no thought text in message), and the caller
 * shows a retry/unavailable state.
 */
export async function suggestUntangleReframes(
  input: UntangleReframeInput
): Promise<Result<UntangleReframeCandidates>> {
  const prompt = buildUntangleReframePrompt(input)
  let raw: string
  try {
    const output = await LLMBridge.synthesise(prompt, {
      maxTokens: 120,
      temperature: 0.6,
    })
    raw = output.text
  } catch (e) {
    return err('REFRAME_INFERENCE_FAILED', 'Deep model reframe inference failed', e)
  }

  const parsed = parseReframeCandidates(raw)
  if (!parsed) {
    return err('REFRAME_PARSE_FAILED', 'Could not parse reframe candidates')
  }

  const validated = UntangleReframeSchema.safeParse(parsed)
  if (!validated.success) {
    return err('REFRAME_VALIDATION_FAILED', 'Reframe candidates failed validation')
  }

  return ok({
    factual: validated.data.factual,
    gentle: validated.data.gentle,
    action: validated.data.action,
  })
}

interface RawCandidates {
  factual: string
  gentle: string
  action: string
}

/**
 * Parse the model's line-prefixed output into a structured candidate object.
 * The model is instructed to output "factorial:", "gentle:", and "action:" prefixed
 * lines. This parser is lenient: it takes the first non-empty value after each
 * label prefix, stripping common wrapping quotes and leading dashes.
 */
function parseReframeCandidates(text: string): RawCandidates | null {
  const json = extractJson(text)
  if (json && typeof json === 'object') {
    const value = json as Record<string, unknown>
    if (
      typeof value.factual === 'string' &&
      typeof value.gentle === 'string' &&
      typeof value.action === 'string'
    ) {
      return {
        factual: cleanCandidate(value.factual),
        gentle: cleanCandidate(value.gentle),
        action: cleanCandidate(value.action),
      }
    }
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const found: Partial<RawCandidates> = {}
  const labelPattern = /^(?:[-*•]\s*|\d+[.)]\s*)?(?:\*\*)?\s*(factual|realistic|neutral|evidence-based|gentle|compassionate|kind|supportive|action|practical|coping|next[-\s]+step)(?:[-\s]+(?:alternative|view|reframe|thought|next|step|option|oriented))*\s*(?:\*\*)?\s*(?::|[-–—])?\s*(.*)$/i

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(labelPattern)
    if (!match) continue
    const label = candidateKind(match[1])
    if (found[label] !== undefined) continue

    const inline = cleanCandidate(match[2])
    const nextLine = lines[index + 1]
    const candidate = inline || (nextLine ? cleanCandidate(nextLine) : '')
    if (candidate) found[label] = candidate
  }

  if (!found.factual || !found.gentle || !found.action) return null
  return {
    factual: found.factual,
    gentle: found.gentle,
    action: found.action,
  }
}

function candidateKind(raw: string): keyof RawCandidates {
  const label = raw.toLowerCase().replace(/[-\s]+/g, ' ').trim()
  if (['gentle', 'compassionate', 'kind', 'supportive'].includes(label)) return 'gentle'
  if (['action', 'practical', 'coping', 'next step'].includes(label)) return 'action'
  return 'factual'
}

function cleanCandidate(value: string): string {
  return value
    .trim()
    .replace(/^(?:[-*•]\s*)+/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .trim()
}
