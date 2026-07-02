import { assessCrisis, type CrisisAssessment } from '@/services/crisis/detector'
import { scoreCrisis } from '@/services/llm/fast-model'
import { extractEntry } from '@/services/llm/deep-model'
import { type EntryExtract } from '@/services/llm/schemas/entry-extract.schema'
import { applyTags, createEntry, listUnindexedEntries, type Entry } from '@/services/storage/entries'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { setEntitiesForEntry, type NewEntity } from '@/services/storage/entities'
import { getSetting, setSetting } from '@/services/storage/settings'
import { updateGraphForEntry } from '@/services/graph/engine'
import { updateWikiForEntry } from '@/services/wiki/engine'
import { useWikiStore } from '@/store/wiki.store'
import { useSyncStore } from '@/store/sync.store'

export interface ProcessResult {
  crisis: CrisisAssessment
}

/**
 * Persist a deep extraction onto an entry and fan it out to the knowledge base:
 * apply the tags, persist entities (the wiki recurrence count reads them), then
 * the recurrence-gated graph + wiki synthesis. Shared by the journal flow and
 * Reflect-chat capture so there is one indexing path. Best-effort, never throws.
 */
async function indexFromExtract(entry: Entry, ex: EntryExtract): Promise<void> {
  await applyTags(entry.id, {
    emotion: ex.emotion,
    distortion: ex.distortion,
    mood_score: ex.mood_score,
    topic: ex.topic,
  })

  // Persist entities before graph/wiki run — the graph reads them for
  // person/place/activity nodes and the wiki uses the recurrence count (which
  // must include this entry). Cheap DB write; await it.
  const entities: NewEntity[] = [
    ...ex.people.map((label) => ({ type: 'person' as const, label })),
    ...ex.places.map((label) => ({ type: 'place' as const, label })),
    ...ex.activities.map((label) => ({ type: 'activity' as const, label })),
    ...ex.beliefs.map((label) => ({ type: 'belief' as const, label })),
    ...ex.behaviors.map((label) => ({ type: 'behavior' as const, label })),
  ]
  await setEntitiesForEntry(entry.id, entities)

  // Tags are now persisted. Bump the data revision so any focused screen
  // (the timeline EntryCard's "tagging…", the graph) re-reads and shows them
  // immediately — background tagging otherwise only surfaces on the next screen
  // refocus. Mirrors what a sync pull does.
  useSyncStore.getState().bumpRevision()

  const taggedEntry: Entry = {
    ...entry,
    emotion: ex.emotion,
    distortion: ex.distortion,
    mood_score: ex.mood_score,
    topic: ex.topic,
    tagged_at: Date.now(),
  }
  // Graph update is cheap (DB only) — fire-and-forget.
  void updateGraphForEntry(taggedEntry, ex.topic)

  // Wiki synthesis is the slow deep-model step — track it for the indicator.
  useWikiStore.getState().begin()
  void updateWikiForEntry(taggedEntry, ex.topic).finally(() => useWikiStore.getState().end())
}

/**
 * Background: run the deep extraction for an entry, then index it. The deep model
 * owns every knowledge-base signal now (emotion/distortion/topic/mood/entities) —
 * it's slower than the fast model but far more consistent, and the graph/wiki
 * aren't needed synchronously. On failure the entry stays saved but un-indexed
 * (parity with a tag failure before). Best-effort, never throws.
 */
async function extractThenIndex(entry: Entry): Promise<void> {
  const ex = await extractEntry({
    situation: entry.situation,
    thought: entry.thought,
    behavior: entry.behavior,
    closing_note: entry.closing_note,
  })
  if (!ex.success) return
  await indexFromExtract(entry, ex.data)
}

/**
 * Launch-time self-heal: re-index entries whose deep-model synthesis was cut
 * short (app backgrounded/killed before the background index finished), which on
 * a single device nothing else retries. Fire-and-forget from storage init —
 * never blocks launch, never throws.
 *
 * Snapshots the un-indexed list ONCE, so it can't race a live save (new entries
 * this session aren't in the snapshot, and snapshot entries are from prior
 * sessions) — no double-indexing, which would double-count additive graph edges.
 * Gated on the deep model being present, so it doesn't churn before models exist.
 */
export async function catchUpUnindexed(): Promise<void> {
  if (!(await isModelDownloaded('deep'))) return
  const res = await listUnindexedEntries()
  if (!res.success || res.data.length === 0) return
  // Sequential — the deep context runs one completion at a time anyway, and this
  // yields to any live save between entries.
  for (const entry of res.data) {
    await extractThenIndex(entry)
  }
}

/**
 * Post-save processing for an entry (run after createEntry, off the save path):
 *   1. fast-model crisis score -> crisis assessment (sync; the only blocking step)
 *   2. deep-model extraction -> tags + entities + graph + wiki (background)
 *
 * Never throws. If the crisis score fails the keyword safety net still runs; if
 * the deep extract fails the entry is saved but simply not indexed (ADR 004).
 */
export async function processEntry(entry: Entry): Promise<ProcessResult> {
  // A quick mood log has no written text — nothing to score for crisis or to
  // extract tags/wiki/graph from. Skip all model work; it's not in distress.
  if (entry.situation.trim() === '' && entry.thought.trim() === '') {
    return { crisis: assessCrisis('', 0) }
  }

  // Synchronous, safety-critical: score crisis with the fast model so the caller
  // can route to /crisis immediately. Failure → 0, the keyword net still fires.
  const crisisResult = await scoreCrisis({
    situation: entry.situation,
    thought: entry.thought,
    behavior: entry.behavior,
    closing_note: entry.closing_note,
  })
  const crisisConfidence = crisisResult.success ? crisisResult.data.crisis_confidence : 0

  const text = `${entry.situation}\n${entry.thought}`
  const crisis = assessCrisis(text, crisisConfidence)

  // Everything else (emotion/distortion/topic/mood/entities → graph + wiki) is
  // the deep model's job, in the background — never blocks the save or crisis.
  void extractThenIndex(entry)

  return { crisis }
}

// Map the fast model's normalized mood_score (0..1) onto the entries.mood
// 1..5 scale. Reflect captures have no self-rated mood, so we use the inferred
// one rather than a fake constant.
function moodFromScore(score: number): number {
  return Math.min(5, Math.max(1, Math.round(score * 4) + 1))
}

// A Reflect message must be stated this many times before it's allowed into the
// knowledge base — a one-off chat tangent never spawns graph/wiki nodes.
const MIN_REFLECT_MENTIONS = 2
const reflectThemeKey = (theme: string) => `reflect:theme:${theme.trim().toLowerCase()}`

// Questions are prompts/queries, not reflections — they must never be ingested.
function isQuestion(text: string): boolean {
  return /\?\s*$/.test(text.trim())
}

/**
 * Capture durable knowledge from a Reflect-chat message into the wiki/graph —
 * deliberately conservative so conversation noise never pollutes the knowledge
 * base. Only the user's own message reaches here (companion turns are never
 * passed in). We then: (1) skip questions, (2) require a real theme, and (3) gate
 * on recurrence — a theme is ingested only once the user has stated it at least
 * MIN_REFLECT_MENTIONS times in Reflect, never on first mention. Qualifying
 * statements are persisted as a `source:'reflect'` entry and indexed like a
 * journal entry. Background, best-effort: never throws, never blocks a reply.
 */
export async function captureReflectMessage(message: string): Promise<void> {
  if (isQuestion(message)) return

  // Deep extraction gives the topic (for the recurrence gate) and mood.
  const ex = await extractEntry({ situation: message, thought: '' })
  if (!ex.success) return

  const theme = ex.data.topic.trim()
  if (!theme || theme.toLowerCase() === 'none') return // no trackable statement

  // Count this mention; only ingest from the Nth onward.
  const key = reflectThemeKey(theme)
  const prev = await getSetting(key)
  const count = (prev.success && prev.data ? Number(prev.data) : 0) + 1
  await setSetting(key, String(count))
  if (count < MIN_REFLECT_MENTIONS) return

  const created = await createEntry({
    mood: moodFromScore(ex.data.mood_score),
    situation: message,
    thought: '',
    source: 'reflect',
  })
  if (!created.success) return

  await indexFromExtract(created.data, ex.data)
}

/**
 * Capture the answers from a completed guided path. Each non-empty answer becomes
 * its own `source:'path'` entry, indexed into the wiki/graph immediately — no
 * recurrence gate (unlike Reflect chat): the user deliberately chose this
 * reflection, it isn't incidental. Path entries stay out of the journal timeline
 * (which filters `source='journal'`) but compound the knowledge base like any entry.
 *
 * Returns one crisis assessment over the combined answers so the runner can route
 * to /crisis — safety parity with a journal save, since paths deliberately probe
 * hard feelings. The crisis score is the only blocking step; indexing is background.
 * Never throws.
 */
export async function capturePathAnswers(answers: string[]): Promise<CrisisAssessment> {
  const nonEmpty = answers.map((a) => a.trim()).filter((a) => a !== '')
  if (nonEmpty.length === 0) return assessCrisis('', 0)

  // Synchronous, safety-critical: one fast-model crisis score over the combined
  // answers; the keyword net still fires on failure.
  const combined = nonEmpty.join('\n')
  const crisisResult = await scoreCrisis({ situation: combined, thought: '' })
  const crisisConfidence = crisisResult.success ? crisisResult.data.crisis_confidence : 0
  const crisis = assessCrisis(combined, crisisConfidence)

  // Create the entries now (fast DB writes), so a completed path reliably and
  // promptly counts — toward the streak and the knowledge base — even if the deep
  // model is slow or fails (ADR 004: LLM failures never lose the entry). `mood` is
  // a neutral placeholder: path entries are excluded from every journal-mood
  // aggregation (timeline, trends, digest); only their day and their extracted
  // tags (set in the background below) are ever read.
  const created: Entry[] = []
  for (const answer of nonEmpty) {
    const res = await createEntry({ mood: NEUTRAL_MOOD, situation: answer, thought: '', source: 'path' })
    if (res.success) created.push(res.data)
  }

  // Enrich each entry (tags → graph + wiki) in the background — never blocks completion.
  void indexPathEntries(created)

  return crisis
}

// A path answer has no self-rated mood; the column is inert for path entries, so
// a neutral value is fine. The inferred mood_score is still set by the deep model.
const NEUTRAL_MOOD = 3

async function indexPathEntries(entries: Entry[]): Promise<void> {
  for (const entry of entries) {
    const ex = await extractEntry({ situation: entry.situation, thought: '' })
    if (!ex.success) continue
    await indexFromExtract(entry, ex.data)
  }
}
