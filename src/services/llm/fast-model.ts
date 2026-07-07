import { LLMBridge } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'

import { buildCrisisPrompt, buildSummaryCrisisPrompt, type CrisisPromptInput } from './prompts/crisis-signal'
import { buildExpandQueryPrompt } from './prompts/expand-query'
import { CrisisSignalSchema, type CrisisSignal } from './schemas/crisis-signal.schema'
import { ExpandQuerySchema } from './schemas/expand-query.schema'

// Pull the first {...} object out of the model output (it may add stray text).
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
 * Score crisis/self-harm risk with the fast model — the one extraction that must
 * be synchronous (≤2s), so the entry can route to /crisis the instant it saves.
 * Everything else is extracted by the deep model in the background. Never throws;
 * a failure means "no model score" (the keyword safety net still runs). Errors
 * carry a code only, never entry text.
 */
export async function scoreCrisis(input: CrisisPromptInput): Promise<Result<CrisisSignal>> {
  let raw: string
  try {
    const output = await LLMBridge.tag(buildCrisisPrompt(input), { maxTokens: 40, temperature: 0.1 })
    raw = output.text
  } catch (e) {
    return err('CRISIS_INFERENCE_FAILED', 'Fast model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) return err('CRISIS_PARSE_FAILED', 'No JSON object found in model output')

  const parsed = CrisisSignalSchema.safeParse(json)
  if (!parsed.success) return err('CRISIS_VALIDATION_FAILED', 'Crisis output failed schema validation')

  return ok(parsed.data)
}

const MAX_EXPANSION_KEYWORDS = 5
const MAX_KEYWORD_LEN = 40

/**
 * Generate a few alternate keywords/phrasings for a Reflect message (HyDE-style
 * query expansion), to widen lexical retrieval over the wiki. Best-effort: a
 * model/parse failure returns an error the caller treats as "no expansion", so
 * retrieval still runs on graph + embeddings. Output is cleaned and capped.
 * Never logs message text.
 */
export async function expandQueryTerms(message: string): Promise<Result<string[]>> {
  let raw: string
  try {
    const output = await LLMBridge.tag(buildExpandQueryPrompt(message), { maxTokens: 48, temperature: 0.2 })
    raw = output.text
  } catch (e) {
    return err('EXPAND_INFERENCE_FAILED', 'Fast model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) return err('EXPAND_PARSE_FAILED', 'No JSON object found in model output')

  const parsed = ExpandQuerySchema.safeParse(json)
  if (!parsed.success) return err('EXPAND_VALIDATION_FAILED', 'Expand output failed schema validation')

  const terms = parsed.data.keywords
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && k.length <= MAX_KEYWORD_LEN)
    .slice(0, MAX_EXPANSION_KEYWORDS)
  return ok(terms)
}

/**
 * Score distress from the rolling conversation summary, once per refresh, using
 * the fast model. The summary captures themes across many turns, so a cumulative
 * distress signal that no single message triggered keyword-wise may surface here.
 * Best-effort: a failure returns an error the caller treats as "no signal" — the
 * keyword safety net on individual messages is unchanged. Never logs summary text.
 */
export async function scoreSummaryCrisis(summary: string): Promise<Result<CrisisSignal>> {
  let raw: string
  try {
    const output = await LLMBridge.tag(buildSummaryCrisisPrompt(summary), {
      maxTokens: 40,
      temperature: 0.1,
    })
    raw = output.text
  } catch (e) {
    return err('SUMMARY_CRISIS_INFERENCE_FAILED', 'Fast model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) return err('SUMMARY_CRISIS_PARSE_FAILED', 'No JSON object found in model output')

  const parsed = CrisisSignalSchema.safeParse(json)
  if (!parsed.success) return err('SUMMARY_CRISIS_VALIDATION_FAILED', 'Crisis output failed schema validation')

  return ok(parsed.data)
}
