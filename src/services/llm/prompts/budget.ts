/**
 * Prompt input budget for the deep model.
 *
 * The deep model runs at `n_ctx = 2048` (see LLMBridge.loadContext). A prompt
 * that overruns that window silently context-shifts — llama.cpp drops the
 * oldest tokens — which discards the leading instructions and lets synthesis
 * drift. This module bounds the RENDERED prompt to a budget computed from that
 * context window minus the output reserve and a safety margin, so instructions
 * and the newest evidence always fit.
 *
 *   CONTEXT_WINDOW      = 2048            (llama.rn n_ctx)
 *   OUTPUT_RESERVE      = 400             (max_tokens requested for synthesis)
 *   SAFETY_MARGIN       = 128             (BPE/chat-template + error slack)
 *   PROMPT_INPUT_BUDGET = 1520            (max estimated/measured input)
 */
export const CONTEXT_WINDOW = 2048
export const OUTPUT_RESERVE = 400
export const SAFETY_MARGIN = 128
export const PROMPT_INPUT_BUDGET = CONTEXT_WINDOW - OUTPUT_RESERVE - SAFETY_MARGIN // 1520

// ─────────────────────────────────────────────────────────────────────────────
// estimatePromptTokens
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CONSERVATIVE upper bound on the real Qwen2.5 BPE token count of `text`.
 *
 * This is an ESTIMATE, not exact token counting. The on-device model context
 * is not loaded when prompts are built (these are pure functions called far
 * from inference), and loading a context just to call `ctx.tokenize()` would
 * cost 1–2s and ~GB of RAM per prompt build — unacceptable on the wiki save
 * path. `llama.rn` does expose `tokenize()`, but only on an already-loaded
 * `LlamaContext`, which we deliberately do not hold here.
 *
 * Because the budget trims EARLY rather than late, the estimator must be an
 * OVER-estimate: when in doubt, round up. A prompt trimmed to fit the estimate
 * then also fits the real context. (Do NOT interpret this as a ±10% tokenizer
 * — the real count can be materially lower; that is the intended slack.)
 *
 * Handles the scripts the wiki actually sees: Latin word punctuation, CJK,
 * mixed Latin+CJK, punctuation runs, and emoji/ZWJ grapheme clusters.
 */
export function estimatePromptTokens(text: string): number {
  if (text.length === 0) return 0

  // Grapheme-aware: emoji ZWJ sequences (👍🏽) and combining clusters are several
  // code points but one user-perceived unit. `\p{Extended_Pictographic}` covers
  // base emoji; a follow-up \uFE0F or \p{E_Modifier} (skin-tone) is part of the
  // same cluster. Walk split-on-grapheme so emoji aren't over-counted as 3+ Latin
  // tokens each, but ALSO aren't under-counted as 1 free char.
  const graphemes = splitGraphemes(text)

  let cjk = 0
  let emoji = 0
  let punct = 0
  let latinChars = 0
  let latinWords = 0
  let inWord = false

  for (const g of graphemes) {
    const isEmoji = g.codePointAt(0) != null &&
      (isEmojiCodePoint(g.codePointAt(0)!) || g.includes('\uFE0F') || g.includes('\u200D'))
    if (isEmoji) {
      emoji++
      continue
    }
    // Each non-emoji grapheme is one code point. Classify it.
    const ch = g.codePointAt(0) ?? 0
    if (isCJK(ch)) {
      cjk++
    } else if (isPunct(ch)) {
      punct++
    } else if (isWhitespace(ch)) {
      if (inWord) { latinWords++; inWord = false }
    } else {
      // Latin-letter or other letter
      latinChars++
      inWord = true
    }
  }
  if (inWord) latinWords++

  // Latin: BPE splits words and punctuation. A reasonable conservative estimate
  // is max(words * 1.3, chars / 4). Words dominate short prose; chars/4 catches
  // very long tokens / URLs.
  const latinTokens = Math.max(Math.ceil(latinWords * 1.3), Math.ceil(latinChars / 4))

  // CJK: Qwen2.5 BPE tokenises ideographs at roughly 1 token per ~2
  // characters (some merges happen). 0.5 tokens/char is exactly at the lower
  // bound and can tip under on punctuation-heavy stretches, so use 0.6 — a
  // genuine conservative upper bound that never lands on the floor.
  const cjkTokens = Math.ceil(cjk * 0.6)

  // Punctuation runs are NOT free — a run of ",,,,," is ~1 token per 3 chars.
  const punctTokens = Math.ceil(punct / 3)

  // Emoji each tokenise to ~2 BPE tokens (the ZWJ/variant sequence fragments).
  const emojiTokens = emoji * 2

  const estimate = latinTokens + cjkTokens + punctTokens + emojiTokens

  // Floor: never below chars/4. Protects against an unknown script silently
  // slipping through every classifier above and being counted as 0.
  const floor = Math.ceil(text.length / 4)
  return Math.max(estimate, floor)
}

/** CJK Unified Ideographs + common extensions + Hangul + Hiragana/Katakana + Bopomofo. */
function isCJK(cp: number): boolean {
  return (
    (cp >= 0x3400 && cp <= 0x9fff) ||   // CJK Unified + Ext A
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK Compatibility
    (cp >= 0x20000 && cp <= 0x2ffff) ||  // CJK Ext B+
    (cp >= 0xac00 && cp <= 0xd7af) ||   // Hangul Syllables
    (cp >= 0x3040 && cp <= 0x30ff) ||   // Hiragana + Katakana
    (cp >= 0x31a0 && cp <= 0x31bf)      // Bopomofo Extended
  )
}

function isWhitespace(cp: number): boolean {
  return cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d ||
    cp === 0xa0 || cp === 0x2028 || cp === 0x2029
}

function isPunct(cp: number): boolean {
  // ASCII punctuation + common Unicode punctuation, NOT whitespace, NOT emoji.
  return (
    (cp >= 0x21 && cp <= 0x2f) ||
    (cp >= 0x3a && cp <= 0x40) ||
    (cp >= 0x5b && cp <= 0x60) ||
    (cp >= 0x7b && cp <= 0x7e) ||
    (cp >= 0x2000 && cp <= 0x206f) // General Punctuation (em dash, ellipsis…)
  )
}

/**
 * Split `text` into user-perceived graphemes, so that a ZWJ emoji sequence
 * (👍🏽 = 👍 U+200D 🏽) or a combining-mark cluster is ONE element, not several.
 * Intl.Segmenter with `{ granularity: 'grapheme' }` is available in the RN
 * Hermes/V8 runtime; if it's somehow absent, falls back to Array.from
 * (Unicode code points — still code-point-safe, just coarser).
 */
function splitGraphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (s: string, o: { granularity: 'grapheme' }) => { [Symbol.iterator](): IterableIterator<{ segment: string }> } }).Segmenter
  if (Seg) {
    try {
      return [...new Seg(text, { granularity: 'grapheme' })].map((x) => x.segment)
    } catch {
      // fall through
    }
  }

  // Hermes versions without Intl.Segmenter still get a cluster-aware fallback:
  // attach combining marks, variation selectors, skin tones, and ZWJ-linked
  // code points to the preceding base rather than splitting user-visible text.
  const out: string[] = []
  for (const codePoint of Array.from(text)) {
    const cp = codePoint.codePointAt(0) ?? 0
    const previous = out[out.length - 1]
    if (previous && (cp === 0x200d || isCombiningMark(cp) || isVariationSelector(cp) || isEmojiModifier(cp) || previous.endsWith('\u200D'))) {
      out[out.length - 1] = previous + codePoint
    } else {
      out.push(codePoint)
    }
  }
  return out
}

function isCombiningMark(cp: number): boolean {
  return (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
}

function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)
}

function isEmojiModifier(cp: number): boolean {
  return cp >= 0x1f3fb && cp <= 0x1f3ff
}

function isEmojiCodePoint(cp: number): boolean {
  return Extended_Pictographic.has(cp) ||
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x1fc00 && cp <= 0x1ffff) ||
    (cp >= 0x2300 && cp <= 0x23ff) ||
    (cp >= 0x2600 && cp <= 0x27bf)
}

/**
 * The set of code points that are Extended_Pictographic (per Unicode TR51).
 * Stored as a Set of code points for fast lookup. We only seed the
 * high-traffic ranges' base code points; the per-grapheme emoji check above
 * also covers ZWJ (U+200D) and variation-selector (U+FE0F) continuations.
 */
const Extended_Pictographic = new Set<number>([
  0x1f300, 0x1f301, 0x1f302, 0x1f303, 0x1f304, 0x1f305, 0x1f306, 0x1f307,
  0x1f308, 0x1f309, 0x1f30a, 0x1f30b, 0x1f30c, 0x1f30d, 0x1f30e, 0x1f30f,
  0x1f310, 0x1f311, 0x1f312, 0x1f313, 0x1f314, 0x1f315, 0x1f316, 0x1f317,
  0x1f318, 0x1f319, 0x1f31a, 0x1f31b, 0x1f31c, 0x1f31d, 0x1f31e, 0x1f31f,
  0x1f320, 0x1f321, 0x1f324, 0x1f325, 0x1f326, 0x1f327, 0x1f328, 0x1f329,
  0x1f32a, 0x1f32b, 0x1f32c, 0x1f32d, 0x1f32e, 0x1f32f, 0x1f330, 0x1f331,
  0x1f332, 0x1f333, 0x1f334, 0x1f335, 0x1f336, 0x1f337, 0x1f338, 0x1f339,
  0x1f33a, 0x1f33b, 0x1f33c, 0x1f33d, 0x1f33e, 0x1f33f, 0x1f340, 0x1f341,
  0x1f342, 0x1f343, 0x1f344, 0x1f345, 0x1f346, 0x1f347, 0x1f348, 0x1f349,
  0x1f34a, 0x1f34b, 0x1f34c, 0x1f34d, 0x1f34e, 0x1f34f, 0x1f350, 0x1f351,
  // Face emoji range (smileys)
  0x1f600, 0x1f601, 0x1f602, 0x1f603, 0x1f604, 0x1f605, 0x1f606, 0x1f607,
  0x1f608, 0x1f609, 0x1f60a, 0x1f60b, 0x1f60c, 0x1f60d, 0x1f60e, 0x1f60f,
  0x1f610, 0x1f611, 0x1f612, 0x1f613, 0x1f614, 0x1f615, 0x1f616, 0x1f617,
  0x1f618, 0x1f619, 0x1f61a, 0x1f61b, 0x1f61c, 0x1f61d, 0x1f61e, 0x1f61f,
  0x1f620, 0x1f621, 0x1f622, 0x1f623, 0x1f624, 0x1f625, 0x1f626, 0x1f627,
  0x1f628, 0x1f629, 0x1f62a, 0x1f62b, 0x1f62c, 0x1f62d, 0x1f62e, 0x1f62f,
  0x1f630, 0x1f631, 0x1f632, 0x1f633, 0x1f634, 0x1f635, 0x1f636, 0x1f637,
  0x1f638, 0x1f639, 0x1f63a, 0x1f63b, 0x1f63c, 0x1f63d, 0x1f63e, 0x1f63f,
  0x1f640, 0x1f641, 0x1f642, 0x1f643, 0x1f644, 0x1f645, 0x1f646, 0x1f647,
  0x1f648, 0x1f649, 0x1f64a, 0x1f64b, 0x1f64c, 0x1f64d, 0x1f64e, 0x1f64f,
  // Thumbs up/down + person gestures (commonly combined with skin-tone modifiers)
  0x1f44a, 0x1f44b, 0x1f44c, 0x1f44d, 0x1f44e, 0x1f44f, 0x1f450,
  0x1f600, 0x1f64f, 0x1f680, 0x1f681, 0x1f682,
  // Dingbats (incl. thumbs ★ ✋ etc.)
  0x2705, 0x274c, 0x274e, 0x2753, 0x2757, 0x2764, 0x2763,
  0x2714, 0x2716, 0x2728, 0x2764, 0x270a, 0x270b, 0x270c, 0x270d,
])

// ─────────────────────────────────────────────────────────────────────────────
// truncateMiddle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trim `text` to roughly `maxChars` characters by DROPPING THE MIDDLE and
 * preserving both the head and tail, joined by a single `'…'` ellipsis.
 * Never splits a Unicode code point (grapheme-aware). Returns the input
 * untouched when it is already at or under the ceiling.
 *
 * Used to keep a long existing-page prior in the prompt without losing its
 * opening (the gist) or its ending (the most recent state). The middle is the
 * first content dropped because it is the least informative in a synthesis
 * prior — the model re-consolidates from the head and tail.
 */
export function truncateMiddle(text: string, maxChars: number): string {
  const graphemes = splitGraphemes(text)
  if (graphemes.length <= maxChars) return text
  if (maxChars <= 1) return '…'
  const body = maxChars - 1
  const headLen = Math.ceil(body / 2)
  const tailLen = body - headLen
  return graphemes.slice(0, headLen).join('') + '…' + graphemes.slice(-tailLen).join('')
}
