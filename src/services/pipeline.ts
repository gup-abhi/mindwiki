import { assessCrisis, type CrisisAssessment } from '@/services/crisis/detector'
import { tagEntry } from '@/services/llm/fast-model'
import { applyTags, type Entry } from '@/services/storage/entries'
import { setEntitiesForEntry, type NewEntity } from '@/services/storage/entities'
import { updateGraphForEntry } from '@/services/graph/engine'
import { updateWikiForEntry } from '@/services/wiki/engine'
import { useWikiStore } from '@/store/wiki.store'

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
  const tagResult = await tagEntry({
    situation: entry.situation,
    thought: entry.thought,
    behavior: entry.behavior,
    closing_note: entry.closing_note,
  })

  let tagged = false
  let crisisConfidence = 0

  if (tagResult.success) {
    crisisConfidence = tagResult.data.crisis_confidence
    const applied = await applyTags(entry.id, {
      emotion: tagResult.data.emotion,
      distortion: tagResult.data.distortion,
      mood_score: tagResult.data.mood_score,
      topic: tagResult.data.topic,
    })
    tagged = applied.success

    // Persist extracted entities before graph/wiki run — the graph reads them to
    // build person/place/activity nodes and the wiki uses the recurrence count
    // (which must include this entry). Cheap DB write; await it.
    const entities: NewEntity[] = [
      ...tagResult.data.people.map((label) => ({ type: 'person' as const, label })),
      ...tagResult.data.places.map((label) => ({ type: 'place' as const, label })),
      ...tagResult.data.activities.map((label) => ({ type: 'activity' as const, label })),
    ]
    await setEntitiesForEntry(entry.id, entities)

    const taggedEntry: Entry = {
      ...entry,
      emotion: tagResult.data.emotion,
      distortion: tagResult.data.distortion,
      mood_score: tagResult.data.mood_score,
      topic: tagResult.data.topic,
      tagged_at: Date.now(),
    }
    // Graph update is cheap (DB only) — fire-and-forget.
    void updateGraphForEntry(taggedEntry, tagResult.data.topic)

    // Wiki synthesis is the slow deep-model step — track it for the indicator.
    useWikiStore.getState().begin()
    void updateWikiForEntry(taggedEntry, tagResult.data.topic).finally(() =>
      useWikiStore.getState().end()
    )
  }

  const text = `${entry.situation}\n${entry.thought}`
  const crisis = assessCrisis(text, crisisConfidence)

  return { tagged, crisis }
}
