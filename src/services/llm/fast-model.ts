import { LLMBridge } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'

import { buildTagPrompt, type TagPromptInput } from './prompts/tag-entry'
import { EntryTagSchema, type EntryTag } from './schemas/entry-tag.schema'
import { canonicalizeEmotion, canonicalizeDistortion } from './taxonomy'

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

// The writer is never an extracted "person"; drop self-references the model
// sometimes emits.
const FIRST_PERSON = new Set(['i', 'me', 'my', 'myself', 'we', 'us', 'mine', 'none'])

function titleCase(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * Clean a raw entity list from the model: trim, drop blanks / 'none' /
 * first-person, title-case, de-dupe case-insensitively, cap at 3. Keeps junk out
 * of the graph + wiki regardless of how noisy the small on-device model is.
 */
export function normalizeEntities(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const label = titleCase(item.trim())
    const key = label.toLowerCase()
    if (!label || FIRST_PERSON.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(label)
    if (out.length >= 3) break
  }
  return out
}

/**
 * Tag an entry with the fast model. Runs inference, extracts + Zod-validates the
 * JSON, and returns a Result. Never throws — caller must treat failure as "skip
 * tagging", never as "fail the save". Errors carry a code only, never entry text.
 */
export async function tagEntry(input: TagPromptInput): Promise<Result<EntryTag>> {
  let raw: string
  try {
    // 150 tokens leaves room for the three entity lists on top of the scalars.
    const output = await LLMBridge.tag(buildTagPrompt(input), { maxTokens: 150, temperature: 0.2 })
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

  return ok({
    ...parsed.data,
    // Snap to the controlled vocabulary so near-synonyms collapse to one node/page.
    emotion: canonicalizeEmotion(parsed.data.emotion),
    distortion: canonicalizeDistortion(parsed.data.distortion),
    people: normalizeEntities(parsed.data.people),
    places: normalizeEntities(parsed.data.places),
    activities: normalizeEntities(parsed.data.activities),
  })
}
