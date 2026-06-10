import { tagEntry } from '@/services/llm/fast-model'

import { assessCrisis, type CrisisAssessment } from './detector'

/**
 * Assess one conversation message for crisis risk, the same way entries are
 * assessed: the keyword safety net always runs, and the fast model's
 * crisis_confidence is folded in best-effort. If the model fails or isn't
 * downloaded, the keyword net still catches an explicit crisis. Never throws.
 */
export async function assessMessageCrisis(text: string): Promise<CrisisAssessment> {
  let confidence = 0
  const tagResult = await tagEntry({ situation: text, thought: '' })
  if (tagResult.success) confidence = tagResult.data.crisis_confidence
  return assessCrisis(text, confidence)
}
