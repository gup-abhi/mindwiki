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
  buildReGroundPrompt,
  type UpdatePageInput,
  type RewritePageInput,
  type ReGroundInput,
} from './prompts/update-page'
import { ConversationReplySchema, ConversationSummarySchema } from './schemas/conversation.schema'
import { AffirmationSchema } from './schemas/challenge.schema'
import { ReflectionQuestionSchema } from './schemas/digest-question.schema'
import { DigestSynthesisSchema, type DigestSynthesis } from './schemas/digest-synthesis.schema'
import { WikiContentSchema } from './schemas/wiki-update.schema'
import { buildReframePrompt, type ReframePromptInput } from './prompts/reframe-suggest'
import { ReframeSuggestionSchema } from './schemas/reframe.schema'
import { buildDeepenPrompt, type DeepenPromptInput } from './prompts/deepen'
import { DeepenQuestionSchema } from './schemas/deepen.schema'
import { buildExtractPrompt, type ExtractPromptInput, type ExtractOptions } from './prompts/extract-entry'
import { EntryExtractSchema, type EntryExtract } from './schemas/entry-extract.schema'
import { canonicalizeEmotion, canonicalizeDistortion, canonicalizeLabel, singularizeLabel, normalizeEntities, normalizePhrases, normalizeBeliefs } from './taxonomy'

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
  // Re-grounding prompt labels
  /^past entries:/i,
  /^new entry:/i,
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
export async function extractEntry(
  input: ExtractPromptInput,
  options: ExtractOptions = {}
): Promise<Result<EntryExtract>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildExtractPrompt(input, options), {
      // The restatement adds roughly a sentence of output — budget for it so it
      // can't crowd out the entity lists at the end of the JSON.
      maxTokens: options.restate ? 260 : 200,
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

  const topics = parsed.data.topics
    .filter((t: string) => t && t.trim().toLowerCase() !== 'none')
    .slice(0, 2)
    .map((t: string) => singularizeLabel(canonicalizeLabel(t)))

  return ok({
    emotion: canonicalizeEmotion(parsed.data.emotion),
    distortion,
    distortion_confidence: parsed.data.distortion_confidence,
    mood_score: parsed.data.mood_score,
    topics,
    people: normalizeEntities(parsed.data.people),
    places: normalizeEntities(parsed.data.places),
    activities: normalizeEntities(parsed.data.activities),
    beliefs: normalizeBeliefs(parsed.data.beliefs),
    behaviors: normalizePhrases(parsed.data.behaviors),
    restatement: parsed.data.restatement.trim(),
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
 * Synthesize updated wiki-page content using past source entries as primary
 * evidence rather than the incremental telephone chain. Same model, same schema,
 * different prompt. Used at periodic intervals (every 10 entries per page).
 * Never throws; errors carry a code only, never entry/page text.
 */
export async function synthesizePageReGround(input: ReGroundInput): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildReGroundPrompt(input), {
      maxTokens: 400,
      temperature: 0.5,
    })
    raw = output.text
  } catch (e) {
    return err('REGROUND_INFERENCE_FAILED', 'Deep model re-ground inference failed', e)
  }

  const parsed = WikiContentSchema.safeParse(stripScaffolding(raw))
  if (!parsed.success) {
    return err('REGROUND_VALIDATION_FAILED', 'Re-grounded content failed validation')
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
 * Guided-path "go deeper" assist: one gentle follow-up question that invites the
 * user a layer further into the answer they just wrote. Constrained to ask, never
 * assert. Best-effort — an optional tap; on any failure the caller simply doesn't
 * show a follow-up.
 */
export async function deepenReflection(input: DeepenPromptInput): Promise<Result<string>> {
  let raw: string
  try {
    const output = await LLMBridge.synthesise(buildDeepenPrompt(input), {
      maxTokens: 60,
      temperature: 0.7,
    })
    raw = output.text
  } catch (e) {
    return err('DEEPEN_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  // Take the first non-empty line and strip wrapping quotes — the model may add a
  // stray prefix or quote the question.
  const firstLine = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const cleaned = firstLine.replace(/^["']+|["']+$/g, '')
  const parsed = DeepenQuestionSchema.safeParse(cleaned)
  if (!parsed.success) {
    return err('DEEPEN_VALIDATION_FAILED', 'Follow-up question failed validation')
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
// A reply that used its whole token budget can stop mid-sentence ("…even if
// it"). Keep whole sentences only: cut back to the last terminal punctuation.
// A reply with no terminal punctuation at all is left as-is (schema decides).
function trimToSentence(text: string): string {
  const t = text.trim()
  if (/[.!?…"”’)\]]$/.test(t)) return t
  const cut = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'), t.lastIndexOf('…'))
  return cut > 0 ? t.slice(0, cut + 1) : t
}

// Split into whole sentences (terminal punctuation + trailing quotes/brackets).
function sentencesOf(text: string): string[] {
  return text.match(/[^.!?…]+[.!?…]+["”’)\]]*\s*/g) ?? [text]
}

/**
 * Deterministic reply cleanup, mirroring synthesis's scaffolding guard — the
 * 3B model breaks these rules in prose no matter how they're phrased:
 *  - drops sentences that announce the wiki ("Given your background, …");
 *  - when the PREVIOUS reply already ended with a question, strips trailing
 *    question sentences so back-to-back interviewer turns cannot reach the UI.
 * Falls back to the original text rather than returning something empty.
 */
function scrubReply(text: string, banEndingQuestion: boolean): string {
  let parts = sentencesOf(text).filter((s) => !ANNOUNCE_RE.test(s))
  if (banEndingQuestion) {
    while (parts.length > 1 && ENDS_WITH_QUESTION_RE.test(parts[parts.length - 1])) parts.pop()
  }
  const out = parts.join('').trim()
  return out.length > 0 ? out : text.trim()
}

const normalizeSentence = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()

const contentWordsOf = (s: string) =>
  new Set(normalizeSentence(s).split(' ').filter((w) => w.length > 2))

/**
 * Predicate over sentences the companion has already said this conversation —
 * exact repeats and near-repeats (≥80% of the sentence's content words
 * contained in one earlier sentence). Device testing showed the model
 * re-serving the same reflection three replies running ("this cycle of
 * rejection doesn't define your worth…"), which reads as canned, not heard.
 * Reflection once is warmth; the same reflection every turn is a script.
 */
function makeRepeatChecker(priorReplies: string[]): (sentence: string) => boolean {
  const prior = priorReplies.flatMap(sentencesOf)
  const priorNorm = new Set(prior.map(normalizeSentence))
  const priorWordSets = prior.map(contentWordsOf)
  return (sentence: string): boolean => {
    if (prior.length === 0) return false
    if (priorNorm.has(normalizeSentence(sentence))) return true
    const words = contentWordsOf(sentence)
    if (words.size === 0) return false
    return priorWordSets.some((ps) => {
      let hits = 0
      for (const w of words) if (ps.has(w)) hits++
      return hits / words.size >= 0.8
    })
  }
}

function dropRepeatedSentences(text: string, isRepeat: (s: string) => boolean): string {
  return sentencesOf(text)
    .filter((s) => !isRepeat(s))
    .join('')
    .trim()
}

const ANNOUNCE_RE = /\b(given|considering) your (background|history)\b|your (background|history) suggests/i
const ENDS_WITH_QUESTION_RE = /\?["”’)\]]*\s*$/

/**
 * Streaming display gate: forwards only sentences that will survive the final
 * cleanup, so the UI never shows text that later retracts (raw token streaming
 * made the tail of a reply visibly disappear when the trims ran). Sentences
 * flush as they complete; when a question must not end this reply, a question
 * sentence is HELD until a later non-question sentence proves it isn't
 * trailing. A fully-recycled reply emits nothing — which also makes the
 * novelty retry invisible to the user.
 */
function createStreamGate(
  banEndingQuestion: boolean,
  isRepeat: (s: string) => boolean,
  emit?: (chunk: string) => void
): { feed: (token: string) => void } {
  if (!emit) return { feed: () => undefined }
  let buffer = ''
  let held: string[] = []
  return {
    feed(token: string) {
      buffer += token
      for (;;) {
        const m = buffer.match(/^[^.!?…]*[.!?…]+["”’)\]]*\s*/)
        if (!m) break
        const sentence = m[0]
        buffer = buffer.slice(sentence.length)
        if (ANNOUNCE_RE.test(sentence) || isRepeat(sentence)) continue
        if (banEndingQuestion && ENDS_WITH_QUESTION_RE.test(sentence)) {
          held.push(sentence)
          continue
        }
        for (const h of held) emit(h)
        held = []
        emit(sentence)
      }
    },
  }
}

// ~110 tokens ≈ 3-4 sentences: the budget is what actually enforces the
// "short, human" contract — device testing showed the model fills any larger
// budget with boilerplate essays and advice lists.
const CONVERSE_MAX_TOKENS = 110

export async function converseFromWiki(
  input: BuildConversationInput,
  onToken?: (token: string) => void
): Promise<Result<string>> {
  const messages = buildConversationMessages(input)

  // Same alternation condition the prompt builder steers on — enforced here so
  // a model that ignores the steer still cannot ask twice in a row.
  const lastReply = [...input.history].reverse().find((m) => m.role === 'assistant')
  const banEndingQuestion = lastReply != null && /\?\s*$/.test(lastReply.content.trim())
  const isRepeat = makeRepeatChecker(input.history.filter((m) => m.role === 'assistant').map((m) => m.content))
  const finalize = (raw: string) =>
    dropRepeatedSentences(scrubReply(trimToSentence(raw), banEndingQuestion), isRepeat)

  // The gate mirrors the final cleanup sentence-by-sentence, so the streamed
  // text never shows something the cleanup would then take away.
  const gate = createStreamGate(banEndingQuestion, isRepeat, onToken)
  let raw: string
  try {
    raw = (
      await LLMBridge.converse(messages, { maxTokens: CONVERSE_MAX_TOKENS, temperature: 0.4 }, (t) =>
        gate.feed(t)
      )
    ).text
  } catch (e) {
    return err('CONVERSE_INFERENCE_FAILED', 'Deep model inference failed', e)
  }

  let text = finalize(raw)
  if (text.length === 0 && raw.trim().length > 0) {
    // The ENTIRE reply was something the companion already said — regenerate
    // once, hotter, to force novelty (the gate emitted nothing, so the retry
    // is invisible). If even that comes back recycled, serve it anyway: a
    // repeated reflection beats a dead turn.
    try {
      const retryGate = createStreamGate(banEndingQuestion, isRepeat, onToken)
      const second = (
        await LLMBridge.converse(messages, { maxTokens: CONVERSE_MAX_TOKENS, temperature: 0.8 }, (t) =>
          retryGate.feed(t)
        )
      ).text
      const cleaned = finalize(second)
      text = cleaned.length > 0 ? cleaned : scrubReply(trimToSentence(second), banEndingQuestion)
    } catch {
      text = scrubReply(trimToSentence(raw), banEndingQuestion)
    }
  }

  const parsed = ConversationReplySchema.safeParse(text)
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
