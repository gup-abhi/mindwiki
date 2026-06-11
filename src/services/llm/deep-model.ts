import { LLMBridge, type ChatMessage } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'

import {
  buildConversationMessages,
  buildSummaryMessages,
  type BuildConversationInput,
} from './prompts/conversation'
import { buildDigestQuestionPrompt, type DigestQuestionInput } from './prompts/digest-question'
import { buildDigestSynthesisPrompt, type DigestSynthesisInput } from './prompts/digest-synthesis'
import { buildUpdatePagePrompt, type UpdatePageInput } from './prompts/update-page'
import { ConversationReplySchema, ConversationSummarySchema } from './schemas/conversation.schema'
import { ReflectionQuestionSchema } from './schemas/digest-question.schema'
import { DigestSynthesisSchema, type DigestSynthesis } from './schemas/digest-synthesis.schema'
import { WikiContentSchema } from './schemas/wiki-update.schema'

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
 * Synthesize updated wiki-page content with the deep model. Runs in the
 * background (deep model ~18 tok/s on device). Never throws; returns Result.
 * Errors carry a code only, never entry/page text.
 */
export async function synthesizePage(input: UpdatePageInput): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildUpdatePagePrompt(input), {
      maxTokens: 400,
      temperature: 0.5,
    })
    raw = output.text
  } catch (e) {
    return err('SYNTH_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const parsed = WikiContentSchema.safeParse(raw)
  if (!parsed.success) {
    return err('SYNTH_VALIDATION_FAILED', 'Synthesized content failed validation')
  }
  return ok(parsed.data)
}

/**
 * Generate one reflection question for the weekly digest from aggregated
 * observations (derived labels only, no raw entry text). Best-effort; the
 * digest falls back to its templated question on any failure.
 */
export async function generateReflectionQuestion(
  input: DigestQuestionInput
): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildDigestQuestionPrompt(input), {
      maxTokens: 60,
      temperature: 0.7,
    })
    raw = output.text
  } catch (e) {
    return err('DIGEST_QUESTION_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const parsed = ReflectionQuestionSchema.safeParse(raw.trim())
  if (!parsed.success) {
    return err('DIGEST_QUESTION_VALIDATION_FAILED', 'Reflection question failed validation')
  }
  return ok(parsed.data)
}

/**
 * Multi-turn reflective reply grounded ONLY in the supplied wiki context
 * (on-device). Streams tokens to `onToken` as they arrive; the resolved Result
 * carries the validated final text. Never throws; errors carry a code only,
 * never message/page text.
 */
export async function converseFromWiki(
  input: BuildConversationInput,
  onToken?: (token: string) => void
): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.converse(
      buildConversationMessages(input),
      { maxTokens: 220, temperature: 0.4 },
      onToken
    )
    raw = output.text
  } catch (e) {
    return err('CONVERSE_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const parsed = ConversationReplySchema.safeParse(raw.trim())
  if (!parsed.success) {
    return err('CONVERSE_VALIDATION_FAILED', 'Conversation reply failed validation')
  }
  return ok(parsed.data)
}

/**
 * Extend a conversation's rolling recap with the turns that just fell out of the
 * recent window (on-device, background). Folds `previousSummary` + `turns` into
 * an updated recap. Never throws; errors carry a code only, never message text.
 */
export async function summarizeConversation(
  previousSummary: string,
  turns: ChatMessage[]
): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.converse(buildSummaryMessages({ previousSummary, turns }), {
      maxTokens: 200,
      temperature: 0.3,
    })
    raw = output.text
  } catch (e) {
    return err('SUMMARY_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const parsed = ConversationSummarySchema.safeParse(raw.trim())
  if (!parsed.success) {
    return err('SUMMARY_VALIDATION_FAILED', 'Conversation summary failed validation')
  }
  return ok(parsed.data)
}

/**
 * Synthesize the weekly digest (themes / patterns / open questions) from the
 * retriever's material with the deep model. Extracts + Zod-validates the JSON.
 * Never throws; returns Result. Errors carry a code only, never entry text.
 */
export async function synthesizeDigest(
  input: DigestSynthesisInput
): Promise<Result<DigestSynthesis>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildDigestSynthesisPrompt(input), {
      maxTokens: 400,
      temperature: 0.5,
    })
    raw = output.text
  } catch (e) {
    return err('DIGEST_SYNTH_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) {
    return err('DIGEST_SYNTH_PARSE_FAILED', 'No JSON object found in model output')
  }

  const parsed = DigestSynthesisSchema.safeParse(json)
  if (!parsed.success) {
    return err('DIGEST_SYNTH_VALIDATION_FAILED', 'Digest synthesis failed validation')
  }
  return ok(parsed.data)
}
