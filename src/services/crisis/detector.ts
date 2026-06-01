export type CrisisTier = 0 | 1 | 2 | 3

export interface CrisisAssessment {
  tier: CrisisTier
  confidence: number
  keywordMatch: boolean
}

// Safety net: explicit phrases force the highest tier regardless of model
// confidence (the model can under-score a genuine crisis). Phrase-based to keep
// false positives low. Never logged.
const CRISIS_KEYWORDS = [
  'kill myself',
  'killing myself',
  'end my life',
  'end it all',
  'want to die',
  'better off dead',
  'no reason to live',
  "don't want to be here",
  'suicidal',
  'suicide',
  'hurt myself',
  'harm myself',
  'self-harm',
]

export function hasCrisisKeyword(text: string): boolean {
  const lower = text.toLowerCase()
  return CRISIS_KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * Combine the model's crisis confidence (0..1) with a keyword safety net.
 * Thresholds (PLAN Track C):
 *   tier 1 ≥ 0.30 · tier 2 ≥ 0.60 · tier 3 ≥ 0.85 OR explicit keyword.
 * A keyword match always escalates to tier 3.
 */
export function assessCrisis(text: string, confidence: number): CrisisAssessment {
  const keywordMatch = hasCrisisKeyword(text)
  let tier: CrisisTier = 0
  if (keywordMatch || confidence >= 0.85) tier = 3
  else if (confidence >= 0.6) tier = 2
  else if (confidence >= 0.3) tier = 1
  return { tier, confidence, keywordMatch }
}
