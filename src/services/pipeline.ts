import { assessCrisis, type CrisisAssessment } from '@/services/crisis/detector'
import { tagEntry } from '@/services/llm/fast-model'
import { type EntryTag } from '@/services/llm/schemas/entry-tag.schema'
import { applyTags, createEntry, type Entry } from '@/services/storage/entries'
import { setEntitiesForEntry, type NewEntity } from '@/services/storage/entities'
import { updateGraphForEntry } from '@/services/graph/engine'
import { updateWikiForEntry } from '@/services/wiki/engine'
import { useWikiStore } from '@/store/wiki.store'

export interface ProcessResult {
  tagged: boolean
  crisis: CrisisAssessment
}

/**
 * Apply fast-model tags to a saved entry and fan them out to the knowledge base:
 * persist entities (the wiki recurrence count reads them), then graph + wiki
 * synthesis. Shared by the journal flow and Reflect-chat capture so there is one
 * indexing path. Returns whether the tags were persisted. Never throws.
 */
async function indexEntryFromTags(entry: Entry, tags: EntryTag): Promise<boolean> {
  const applied = await applyTags(entry.id, {
    emotion: tags.emotion,
    distortion: tags.distortion,
    mood_score: tags.mood_score,
    topic: tags.topic,
  })

  // Persist extracted entities before graph/wiki run — the graph reads them to
  // build person/place/activity nodes and the wiki uses the recurrence count
  // (which must include this entry). Cheap DB write; await it.
  const entities: NewEntity[] = [
    ...tags.people.map((label) => ({ type: 'person' as const, label })),
    ...tags.places.map((label) => ({ type: 'place' as const, label })),
    ...tags.activities.map((label) => ({ type: 'activity' as const, label })),
  ]
  await setEntitiesForEntry(entry.id, entities)

  const taggedEntry: Entry = {
    ...entry,
    emotion: tags.emotion,
    distortion: tags.distortion,
    mood_score: tags.mood_score,
    topic: tags.topic,
    tagged_at: Date.now(),
  }
  // Graph update is cheap (DB only) — fire-and-forget.
  void updateGraphForEntry(taggedEntry, tags.topic)

  // Wiki synthesis is the slow deep-model step — track it for the indicator.
  useWikiStore.getState().begin()
  void updateWikiForEntry(taggedEntry, tags.topic).finally(() => useWikiStore.getState().end())

  return applied.success
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
    tagged = await indexEntryFromTags(entry, tagResult.data)
  }

  const text = `${entry.situation}\n${entry.thought}`
  const crisis = assessCrisis(text, crisisConfidence)

  return { tagged, crisis }
}

// Map the fast model's normalized mood_score (0..1) onto the entries.mood
// 1..5 scale. Reflect captures have no self-rated mood, so we use the inferred
// one rather than a fake constant.
function moodFromScore(score: number): number {
  return Math.min(5, Math.max(1, Math.round(score * 4) + 1))
}

/**
 * Capture durable knowledge from a Reflect-chat message into the wiki/graph.
 * Conversation often surfaces people, places, activities, or themes the journal
 * hasn't recorded yet. We tag the message and — only when it carries something
 * concrete (a person/place/activity or a real theme, not just an emotion or
 * chit-chat) — persist it as a `source:'reflect'` entry and run the same
 * indexing as a journal entry, so it counts toward entity recurrence and feeds
 * the graph + wiki. Background, best-effort: never throws, never blocks a reply.
 */
export async function captureReflectMessage(message: string): Promise<void> {
  const tagResult = await tagEntry({ situation: message, thought: '' })
  if (!tagResult.success) return

  const tags = tagResult.data
  const hasEntity = tags.people.length + tags.places.length + tags.activities.length > 0
  const theme = tags.topic.trim().toLowerCase()
  const hasTheme = theme.length > 0 && theme !== 'none'
  if (!hasEntity && !hasTheme) return // nothing durable to capture

  const created = await createEntry({
    mood: moodFromScore(tags.mood_score),
    situation: message,
    thought: '',
    source: 'reflect',
  })
  if (!created.success) return

  await indexEntryFromTags(created.data, tags)
}
