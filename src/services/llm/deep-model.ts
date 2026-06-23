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
import { buildReframePrompt, type ReframePromptInput } from './prompts/reframe-suggest'
import { ReframeSuggestionSchema } from './schemas/reframe.schema'
import { buildExtractPrompt, type ExtractPromptInput } from './prompts/extract-entry'
import { EntryExtractSchema, type EntryExtract } from './schemas/entry-extract.schema'
import { canonicalizeEmotion, canonicalizeDistortion, canonicalizeLabel, singularizeLabel, normalizeEntities, normalizePhrases } from './taxonomy'

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
// prompt scaffolding (or the entry skeleton the style forbids), so a line that
// STARTS with one is the small model echoing the prompt rather than synthesizing.
// We strip those lines instead of rejecting the whole output — that way the
// "Regenerate" button can actually CLEAN an already-leaked page, and new
// synthesis never shows the reader scaffolding either. Backstop independent of
// any single prompt's wording. If nothing real is left, WikiContentSchema's
// min-length check fails the synthesis (caller keeps the prior page).
const SCAFFOLDING_LINE = [
  /^current page:/i,
  /^new reflection:/i,
  /^page to rewrite:/i,
  /^reframe lens:/i,
  /^thinking pattern:/i,
  /^feeling:/i,
  /^for your understanding/i,
  /^situation:/i,
  /^thought:/i,
  /^behaviou?r:/i,
]
function stripScaffolding(text: string): string {
  return text
    .split('\n')
    .filter((line) => !SCAFFOLDING_LINE.some((re) => re.test(line.trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extract everything that feeds the knowledge base — emotion, distortion, mood,
 * topic, and entities — with the deep model (KB-grounded, far more consistent
 * than the fast 1.5B, which matters because the recurrence-gated graph needs
 * labels to recur). Background only. Snaps emotion/distortion to the controlled
 * vocabulary, canonicalizes the free-text topic + entity labels so near-variants
 * collapse, and drops a low-confidence distortion to 'none'. Never throws; on
 * failure the entry just isn't indexed. Errors carry a code only, never text.
 */
export async function extractEntry(input: ExtractPromptInput): Promise<Result<EntryExtract>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildExtractPrompt(input), {
      maxTokens: 200,
      temperature: 0.2,
    })
    raw = output.text
  } catch (e) {
    return err('EXTRACT_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  const json = extractJson(raw)
  if (json === undefined) return err('EXTRACT_PARSE_FAILED', 'No JSON object found in model output')

  const parsed = EntryExtractSchema.safeParse(json)
  if (!parsed.success) return err('EXTRACT_VALIDATION_FAILED', 'Extract output failed schema validation')

  const distortion =
    parsed.data.distortion_confidence >= DISTORTION_CONF_THRESHOLD
      ? canonicalizeDistortion(parsed.data.distortion)
      : 'none'

  return ok({
    emotion: canonicalizeEmotion(parsed.data.emotion),
    distortion,
    distortion_confidence: parsed.data.distortion_confidence,
    mood_score: parsed.data.mood_score,
    topic: singularizeLabel(canonicalizeLabel(parsed.data.topic)),
    people: normalizeEntities(parsed.data.people),
    places: normalizeEntities(parsed.data.places),
    activities: normalizeEntities(parsed.data.activities),
    beliefs: normalizePhrases(parsed.data.beliefs),
    behaviors: normalizePhrases(parsed.data.behaviors),
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

  // Strip any echoed scaffolding before validating — keeps the reader from ever
  // seeing prompt lines, and turns a partly-leaked output into its clean prose.
  const parsed = WikiContentSchema.safeParse(stripScaffolding(raw))
  if (!parsed.success) {
    return err('SYNTH_VALIDATION_FAILED', 'Synthesized content failed validation')
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

  const parsed = WikiContentSchema.safeParse(stripScaffolding(raw))
  if (!parsed.success) {
    return err('REGEN_VALIDATION_FAILED', 'Regenerated content failed validation')
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
 * Suggest one balanced alternative to a harsh belief from the user's evidence
 * (CBT cognitive restructuring, on-device). An optional assist for the reframe
 * flow — the user can edit or replace it, and on any failure the field just stays
 * as the user left it. Strips wrapping quotes the model often adds. Never throws;
 * errors carry a code only, never belief/evidence text.
 */
export async function suggestBalancedThought(input: ReframePromptInput): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildReframePrompt(input), {
      maxTokens: 80,
      temperature: 0.6,
    })
    raw = output.text
  } catch (e) {
    return err('REFRAME_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  // The model often returns a single sentence but may add a stray prefix/quotes;
  // take the first non-empty line and strip wrapping quotes.
  const firstLine = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const cleaned = firstLine.replace(/^["']+|["']+$/g, '')
  const parsed = ReframeSuggestionSchema.safeParse(cleaned)
  if (!parsed.success) {
    return err('REFRAME_VALIDATION_FAILED', 'Reframe suggestion failed validation')
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
