import { assessCrisis, type CrisisAssessment } from '@/services/crisis/detector'
import { tagEntry } from '@/services/llm/fast-model'
import { applyTags, type Entry } from '@/services/storage/entries'

export interface ProcessResult {
  tagged: boolean
  crisis: CrisisAssessment
}

/**
 * Post-save processing for an entry (run after createEntry, off the save path):
 *   1. fast-model tag -> applyTags (best effort; never blocks)
 *   2. crisis assessment from the model's crisis_confidence + keyword safety net
 *
 * Never throws. If tagging fails, tags are skipped (ADR 004) but the keyword
 * safety net still runs, so an explicit crisis is caught even without the model.
 */
export async function processEntry(entry: Entry): Promise<ProcessResult> {
  const tagResult = await tagEntry({ situation: entry.situation, thought: entry.thought })

  let tagged = false
  let crisisConfidence = 0

  if (tagResult.success) {
    crisisConfidence = tagResult.data.crisis_confidence
    const applied = await applyTags(entry.id, {
      emotion: tagResult.data.emotion,
      distortion: tagResult.data.distortion,
      mood_score: tagResult.data.mood_score,
    })
    tagged = applied.success
  }

  const text = `${entry.situation}\n${entry.thought}`
  const crisis = assessCrisis(text, crisisConfidence)

  return { tagged, crisis }
}
