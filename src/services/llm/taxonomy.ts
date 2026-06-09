// Controlled vocabulary for emotions + cognitive distortions. The fast model is
// asked to choose from these lists (see prompts/tag-entry.ts), and its output is
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
