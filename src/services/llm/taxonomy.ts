// Controlled vocabulary for emotions + cognitive distortions. The fast model is
// asked to choose from these lists (see prompts/extract-entry.ts), and its output is
// snapped to the nearest canonical term here — so near-synonyms ("anxious",
// "nervous", "worried") collapse to one node/page instead of many.
//
// Edit these lists/aliases to tune what the graph + wiki track. Canonical terms
// are Title Case; matching is case-insensitive.

export const EMOTIONS = [
  'Anxiety',
  'Fear',
  'Stress',
  'Overwhelm',
  'Anger',
  'Frustration',
  'Sadness',
  'Loneliness',
  'Grief',
  'Disappointment',
  'Guilt',
  'Shame',
  'Embarrassment',
  'Insecurity',
  'Jealousy',
  'Confusion',
  'Boredom',
  'Calm',
  'Contentment',
  'Joy',
  'Gratitude',
  'Hope',
  'Pride',
  'Excitement',
  'Love',
  'Relief',
] as const

// The standard CBT distortions. 'none' is a valid value (no distortion present).
export const DISTORTIONS = [
  'All-or-nothing thinking',
  'Overgeneralization',
  'Mental filter',
  'Discounting the positive',
  'Jumping to conclusions',
  'Mind reading',
  'Catastrophizing',
  'Emotional reasoning',
  'Should statements',
  'Labeling',
  'Personalization',
  'Blaming',
  'Magnification',
  'Minimization',
] as const

// Common synonyms → canonical term (keys lowercased).
const EMOTION_ALIASES: Record<string, string> = {
  anxious: 'Anxiety', nervous: 'Anxiety', nervousness: 'Anxiety', worried: 'Anxiety',
  worry: 'Anxiety', uneasy: 'Anxiety', apprehensive: 'Anxiety', tense: 'Anxiety', jittery: 'Anxiety',
  afraid: 'Fear', scared: 'Fear', fearful: 'Fear', terrified: 'Fear',
  stressed: 'Stress', pressured: 'Stress',
  overwhelmed: 'Overwhelm', swamped: 'Overwhelm',
  angry: 'Anger', mad: 'Anger', furious: 'Anger', irritated: 'Anger', annoyed: 'Anger',
  irritation: 'Anger', resentful: 'Anger', resentment: 'Anger',
  frustrated: 'Frustration',
  sad: 'Sadness', unhappy: 'Sadness', down: 'Sadness', blue: 'Sadness', miserable: 'Sadness', sorrow: 'Sadness',
  lonely: 'Loneliness', isolated: 'Loneliness', alone: 'Loneliness',
  grieving: 'Grief', heartbroken: 'Grief',
  disappointed: 'Disappointment', letdown: 'Disappointment',
  guilty: 'Guilt',
  ashamed: 'Shame',
  embarrassed: 'Embarrassment', humiliated: 'Embarrassment',
  insecure: 'Insecurity', inadequate: 'Insecurity', unworthy: 'Insecurity',
  jealous: 'Jealousy', envious: 'Jealousy', envy: 'Jealousy',
  confused: 'Confusion', uncertain: 'Confusion', conflicted: 'Confusion',
  bored: 'Boredom',
  calm: 'Calm', peaceful: 'Calm', relaxed: 'Calm', serene: 'Calm',
  content: 'Contentment', satisfied: 'Contentment',
  happy: 'Joy', glad: 'Joy', cheerful: 'Joy', delighted: 'Joy',
  grateful: 'Gratitude', thankful: 'Gratitude', appreciative: 'Gratitude',
  hopeful: 'Hope', optimistic: 'Hope',
  proud: 'Pride',
  excited: 'Excitement', eager: 'Excitement', enthusiastic: 'Excitement',
  loved: 'Love', affection: 'Love', affectionate: 'Love',
  relieved: 'Relief',
}

const DISTORTION_ALIASES: Record<string, string> = {
  'all or nothing': 'All-or-nothing thinking', 'all-or-nothing': 'All-or-nothing thinking',
  'black and white thinking': 'All-or-nothing thinking', 'black-and-white thinking': 'All-or-nothing thinking',
  'polarized thinking': 'All-or-nothing thinking',
  overgeneralizing: 'Overgeneralization',
  filtering: 'Mental filter', 'mental filtering': 'Mental filter',
  'disqualifying the positive': 'Discounting the positive', 'discounting positives': 'Discounting the positive',
  'fortune telling': 'Jumping to conclusions', 'fortune-telling': 'Jumping to conclusions',
  'mind-reading': 'Mind reading',
  catastrophising: 'Catastrophizing', catastrophize: 'Catastrophizing',
  shoulds: 'Should statements', musts: 'Should statements', 'should statement': 'Should statements',
  mislabeling: 'Labeling', labelling: 'Labeling',
  personalizing: 'Personalization', 'self-blame': 'Personalization',
  blame: 'Blaming',
  magnifying: 'Magnification',
  minimizing: 'Minimization',
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[n]
}

function nearest(value: string, list: readonly string[]): string {
  let best = list[0]
  let bestDist = Infinity
  for (const item of list) {
    const d = levenshtein(value, item.toLowerCase())
    if (d < bestDist) {
      bestDist = d
      best = item
    }
  }
  return best
}

const EMOTION_CANON = new Map(EMOTIONS.map((e) => [e.toLowerCase(), e]))
const DISTORTION_CANON = new Map(DISTORTIONS.map((d) => [d.toLowerCase(), d]))

/** Snap any model emotion to a canonical term (exact → alias → nearest). */
export function canonicalizeEmotion(raw: string): string {
  const key = raw.trim().toLowerCase()
  if (!key) return nearest('', EMOTIONS)
  return EMOTION_CANON.get(key) ?? EMOTION_ALIASES[key] ?? nearest(key, EMOTIONS)
}

/**
 * Snap any model distortion to a canonical term. Unlike emotions, a non-match
 * resolves to 'none' (a valid "no distortion" value) rather than being forced
 * onto the nearest distortion.
 */
export function canonicalizeDistortion(raw: string): string {
  const key = raw.trim().toLowerCase()
  if (!key || key === 'none') return 'none'
  return DISTORTION_CANON.get(key) ?? DISTORTION_ALIASES[key] ?? 'none'
}

// Free-text labels (topics, entities) aren't a controlled vocabulary, but they
// still feed recurrence-gated graph nodes — so near-variants must collapse to one
// label or they never recur. A leading article is the common splitter
// ("the app" vs "App" vs "my app").
const LEADING_ARTICLE = /^(the|a|an|my|your|our)\s+/i

function titleCase(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** Canonical form for a free-text label: trim, collapse spaces, drop a leading
 * article, Title-case the first word — so "the app" / "App" / "my app" → "App". */
export function canonicalizeLabel(raw: string): string {
  const stripped = raw.trim().replace(/\s+/g, ' ').replace(LEADING_ARTICLE, '')
  return titleCase(stripped)
}

// Common nouns that end in "s" but are already singular — never de-pluralize.
const ALREADY_SINGULAR = new Set([
  'stress', 'sadness', 'happiness', 'loneliness', 'awareness', 'kindness',
  'illness', 'business', 'progress', 'focus', 'status', 'crisis', 'news',
  'series', 'species',
])

// Conservative English singularizer for the last word of a label. Tuned for
// precision over recall: it collapses the common plural shapes and otherwise
// leaves the word untouched — it never strips an ending it can't reverse cleanly,
// so it won't mangle "stress" → "stres" or "boxes" → "boxe".
function singularizeWord(word: string): string {
  const lower = word.toLowerCase()
  if (lower.length <= 3 || ALREADY_SINGULAR.has(lower)) return word
  if (/(ss|us|is|ous)$/.test(lower)) return word // stress, status, crisis, anxious
  if (/ies$/.test(lower)) return word.slice(0, -3) + 'y' // boundaries → boundary
  if (/(ses|xes|zes|ches|shes)$/.test(lower)) return word // ambiguous (house/stress) — leave
  if (/s$/.test(lower)) return word.slice(0, -1) // relationships → relationship
  return word
}

/**
 * Singularize the last word of an (already canonicalized) free-text topic so
 * near-duplicates collapse to one wiki page + graph node ("Relationships" and
 * "Relationship" → "Relationship"). Topic only — NOT applied to person/place
 * names, where stripping a trailing "s" would mangle proper nouns ("Athens").
 */
export function singularizeLabel(label: string): string {
  const i = label.lastIndexOf(' ')
  return i === -1
    ? singularizeWord(label)
    : label.slice(0, i + 1) + singularizeWord(label.slice(i + 1))
}

// The writer is never an extracted "person"; drop self-references the model
// sometimes emits.
const FIRST_PERSON = new Set(['i', 'me', 'my', 'myself', 'we', 'us', 'mine', 'none'])

/**
 * Clean a raw entity list from the model: trim, drop blanks / 'none' /
 * first-person, canonicalize the label, de-dupe case-insensitively, cap at 3.
 * Keeps junk out of the graph + wiki and lets near-variants collapse to one node.
 */
export function normalizeEntities(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const label = canonicalizeLabel(item)
    const key = label.toLowerCase()
    if (!label || FIRST_PERSON.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(label)
    if (out.length >= 3) break
  }
  return out
}

/**
 * Clean a raw list of cognitive-signal phrases (beliefs / behaviors) from the
 * model: trim, collapse whitespace, strip trailing punctuation, drop blanks /
 * 'none', capitalize the first letter, de-dupe case-insensitively, cap at `max`.
 * Unlike normalizeEntities it keeps the full phrase (no leading-article strip, no
 * Title-casing) — a belief is a sentence, not a noun. Recurrence still matches by
 * lowercased label, so casing never fragments a node.
 */
export function normalizePhrases(raw: string[], max = 2): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const cleaned = item.trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '')
    const key = cleaned.toLowerCase()
    if (!cleaned || key === 'none' || seen.has(key)) continue
    seen.add(key)
    out.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1))
    if (out.length >= max) break
  }
  return out
}

// Common contractions expanded so surface variants collapse to the same stem
// before dedup. Order matters: "won't" before general n't, "I'm" before shorter.
const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'cannot'],
  [/\blet's\b/g, 'let us'],
  [/\bI'm\b/g, 'I am'],
  [/\byou're\b/g, 'you are'],
  [/\bhe's\b/g, 'he is'],
  [/\bshe's\b/g, 'she is'],
  [/\bit's\b/g, 'it is'],
  [/\bwe're\b/g, 'we are'],
  [/\bthey're\b/g, 'they are'],
  [/\bI've\b/g, 'I have'],
  [/\byou've\b/g, 'you have'],
  [/\bwe've\b/g, 'we have'],
  [/\bthey've\b/g, 'they have'],
  [/\bI'll\b/g, 'I will'],
  [/\byou'll\b/g, 'you will'],
  [/\bhe'll\b/g, 'he will'],
  [/\bshe'll\b/g, 'she will'],
  [/\bwe'll\b/g, 'we will'],
  [/\bthey'll\b/g, 'they will'],
  [/\bI'd\b/g, 'I would'],
  [/\byou'd\b/g, 'you would'],
  [/\bhe'd\b/g, 'he would'],
  [/\bshe'd\b/g, 'she would'],
  [/\bwe'd\b/g, 'we would'],
  [/\bthey'd\b/g, 'they would'],
  [/\bdon't\b/g, 'do not'],
  [/\bdoesn't\b/g, 'does not'],
  [/\bdidn't\b/g, 'did not'],
  [/\bwouldn't\b/g, 'would not'],
  [/\bcouldn't\b/g, 'could not'],
  [/\bshouldn't\b/g, 'should not'],
  [/\bmustn't\b/g, 'must not'],
  [/\bhaven't\b/g, 'have not'],
  [/\bhasn't\b/g, 'has not'],
  [/\bhadn't\b/g, 'had not'],
  [/\baren't\b/g, 'are not'],
  [/\bisn't\b/g, 'is not'],
  [/\bwasn't\b/g, 'was not'],
  [/\bweren't\b/g, 'were not'],
  [/\bneedn't\b/g, 'need not'],
]

/** Weak intensifiers that add emphasis without changing the core claim — dropping
 *  them lets "I am really not good enough" and "I am not good enough" collapse.
 *  Preserves strong modals (never, always, ever) that change the logical meaning. */
const DROP_INTENSIFIERS = /\b(really|just|quite|truly|absolutely|extremely)\s+/gi

/** Leading "That" / "The thought that" frame that wraps a belief but isn't part of it.
 *  Applied AFTER contraction expansion so patterns are simpler. */
const BELIEF_LEADING = /^(that\s+|the\s+(idea|thought|feeling)\s+that\s+)/i

/**
 * Canonicalize a single belief phrase so sentence-level variants collapse across
 * entries. Lossless transforms only — the core claim is unchanged, just the
 * surface form is normalised:
 *
 *   1. Expand contractions ("I'm" → "I am", "don't" → "do not")
 *   2. Drop leading "that" / "the idea that" / "the thought that"
 *   3. Drop weak intensifiers ("really", "just", "quite", "truly")
 *   4. Strip trailing punctuation (periods, spaces)
 *   5. Normalise whitespace
 *
 * "I'm not good enough." and "That I am really not good enough" → both
 * canonicalize to "I am not good enough" — a single label that accumulates.
 */
export function canonicalizeBelief(text: string): string {
  let s = text.trim()
  if (!s) return s
  for (const [re, replacement] of CONTRACTIONS) s = s.replace(re, replacement)
  s = s.replace(BELIEF_LEADING, '')
  s = s.replace(DROP_INTENSIFIERS, '')
  s = s.replace(/[.\s]+$/, '')
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Normalize raw belief labels from the model: canonicalize (folding surface
 * variants to a stable stem), then dedupe case-insensitively — so three entries
 * each expressing the same core belief but phrased differently ("I'm not good
 * enough", "That I am really not good enough", "I am not good enough") collapse
 * to one label and the ≥2 recurrence gate opens.
 *
 * Behaviors (short noun-style labels like "Avoidance") still use
 * {@link normalizePhrases} directly — they need leading-article stripping, not
 * sentence canonicalization.
 */
export function normalizeBeliefs(raw: string[], max = 2): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const can = canonicalizeBelief(item)
    // After canonicalization the belief might collapse to nothing ("just" alone)
    if (!can || can.toLowerCase() === 'none') continue
    const key = can.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(can.charAt(0).toUpperCase() + can.slice(1))
    if (out.length >= max) break
  }
  return out
}
