import { LLMBridge, type ChatMessage } from '@/native/LLMBridge'
import { type Result, ok, err } from '@/types/result'

import {
  buildConversationMessages,
  buildSummaryMessages,
  type BuildConversationInput,
} from './prompts/conversation'
import { buildDigestQuestionPrompt, type DigestQuestionInput } from './prompts/digest-question'
import { buildDigestSynthesisPrompt, type DigestSynthesisInput } from './prompts/digest-synthesis'
import { buildAffirmationPrompt, type AffirmationInput } from './prompts/affirmation'
import {
  buildUpdatePagePrompt,
  buildRewritePagePrompt,
  type UpdatePageInput,
  type RewritePageInput,
} from './prompts/update-page'
import { ConversationReplySchema, ConversationSummarySchema } from './schemas/conversation.schema'
import { AffirmationSchema } from './schemas/challenge.schema'
import { ReflectionQuestionSchema } from './schemas/digest-question.schema'
import { DigestSynthesisSchema, type DigestSynthesis } from './schemas/digest-synthesis.schema'
import { WikiContentSchema } from './schemas/wiki-update.schema'
import { buildAffectPrompt, type AffectPromptInput } from './prompts/classify-affect'
import { AffectTagSchema, type AffectTag } from './schemas/affect-tag.schema'
import { canonicalizeEmotion, canonicalizeDistortion } from './taxonomy'

// Below this confidence we don't trust the distortion call enough to record it —
// a shaky distortion would otherwise seed a (gated, but still) graph node and
// colour the wiki. Drop it to 'none' instead. Tunable knob, not a guarantee.
const DISTORTION_CONF_THRESHOLD = 0.6

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

// A finished wiki page is flowing prose. These labels only ever come from the
// prompt scaffolding (or the entry skeleton the style forbids), so if any appear
// in the output the small model echoed the prompt instead of synthesizing — we
// reject it rather than show the reader the scaffolding. Backstop independent of
// any single prompt's wording.
const PAGE_LEAK_MARKERS = [
  /current page:/i,
  /new reflection:/i,
  /page to rewrite:/i,
  /reframe lens:/i,
  /thinking pattern:/i,
  /for your understanding/i,
  /\bsituation:/i,
  /\bthought:/i,
]
function looksLikePromptLeak(text: string): boolean {
  return PAGE_LEAK_MARKERS.some((re) => re.test(text))
}

/**
 * Re-classify an entry's emotion + distortion with the deep model (KB-grounded,
 * far better than the fast 1.5B at the subtle distortion call). Background only.
 * Snaps both to the controlled vocabulary, and drops a low-confidence distortion
 * to 'none' so only a clearly-present pattern is recorded. Never throws; on any
 * failure the caller keeps the fast tag. Errors carry a code only, never text.
 */
export async function classifyAffect(input: AffectPromptInput): Promise<Result<AffectTag>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildAffectPrompt(input), {
      maxTokens: 80,
      temperature: 0.2,
    })
    raw = output.text
  } catch (e) {
    return err('AFFECT_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) return err('AFFECT_PARSE_FAILED', 'No JSON object found in model output')

  const parsed = AffectTagSchema.safeParse(json)
  if (!parsed.success) return err('AFFECT_VALIDATION_FAILED', 'Affect output failed schema validation')

  const distortion =
    parsed.data.distortion_confidence >= DISTORTION_CONF_THRESHOLD
      ? canonicalizeDistortion(parsed.data.distortion)
      : 'none'

  return ok({
    emotion: canonicalizeEmotion(parsed.data.emotion),
    distortion,
    distortion_confidence: parsed.data.distortion_confidence,
  })
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
  if (looksLikePromptLeak(parsed.data)) {
    // Echoed the prompt — keep the prior page rather than show scaffolding.
    return err('SYNTH_LEAK_REJECTED', 'Output echoed prompt scaffolding')
  }
  return ok(parsed.data)
}

/**
 * Rewrite an existing wiki page in the canonical voice (substance unchanged).
 * Lets pages written before the voice was pinned be brought into a consistent
 * voice on demand. Never throws; errors carry a code only, never page text.
 */
export async function regeneratePage(input: RewritePageInput): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildRewritePagePrompt(input), {
      maxTokens: 400,
      temperature: 0.4,
    })
    raw = output.text
  } catch (e) {
    return err('REGEN_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const parsed = WikiContentSchema.safeParse(raw)
  if (!parsed.success) {
    return err('REGEN_VALIDATION_FAILED', 'Regenerated content failed validation')
  }
  if (looksLikePromptLeak(parsed.data)) {
    return err('REGEN_LEAK_REJECTED', 'Output echoed prompt scaffolding')
  }
  return ok(parsed.data)
}

/**
 * Generate a personal affirmation rewarding a completed challenge, from its
 * title + details (on-device). Best-effort; the caller falls back to a bank
 * affirmation on any failure. Strips wrapping quotes the model often adds. Never
 * throws; errors carry a code only, never challenge text.
 */
export async function generateAffirmation(input: AffirmationInput): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildAffirmationPrompt(input), {
      maxTokens: 60,
      temperature: 0.7,
    })
    raw = output.text
  } catch (e) {
    return err('AFFIRMATION_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const cleaned = raw.trim().replace(/^["']+|["']+$/g, '')
  const parsed = AffirmationSchema.safeParse(cleaned)
  if (!parsed.success) {
    return err('AFFIRMATION_VALIDATION_FAILED', 'Affirmation failed validation')
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
