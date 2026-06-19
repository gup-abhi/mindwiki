import { LLMBridge } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'

import { buildCrisisPrompt, type CrisisPromptInput } from './prompts/crisis-signal'
import { CrisisSignalSchema, type CrisisSignal } from './schemas/crisis-signal.schema'

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
