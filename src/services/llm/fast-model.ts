import { LLMBridge } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'

import { buildTagPrompt, type TagPromptInput } from './prompts/tag-entry'
import { EntryTagSchema, type EntryTag } from './schemas/entry-tag.schema'

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
 * Tag an entry with the fast model. Runs inference, extracts + Zod-validates the
 * JSON, and returns a Result. Never throws — caller must treat failure as "skip
 * tagging", never as "fail the save". Errors carry a code only, never entry text.
 */
export async function tagEntry(input: TagPromptInput): Promise<Result<EntryTag>> {
  let raw: string
  try {
    const output = await LLMBridge.tag(buildTagPrompt(input), { maxTokens: 80, temperature: 0.2 })
    raw = output.text
  } catch (e) {
    return err('TAG_INFERENCE_FAILED', 'Fast model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) {
    return err('TAG_PARSE_FAILED', 'No JSON object found in model output')
  }

  const parsed = EntryTagSchema.safeParse(json)
  if (!parsed.success) {
    return err('TAG_VALIDATION_FAILED', 'Tag output failed schema validation')
  }

  return ok(parsed.data)
}
