import { assessCrisis, type CrisisAssessment } from '@/services/crisis/detector'
import { scoreCrisis } from '@/services/llm/fast-model'
import { extractEntry } from '@/services/llm/deep-model'
import { type EntryExtract } from '@/services/llm/schemas/entry-extract.schema'
import {
  applyTags,
  createEntry,
  listUnindexedEntries,
  listWikiPendingEntries,
  listGraphPendingEntries,
  markWikiIndexed,
  markGraphIndexed,
  type Entry,
} from '@/services/storage/entries'
import { isModelDownloaded } from '@/services/llm/model-manager'
import { setEntitiesForEntry, type NewEntity } from '@/services/storage/entities'
import { getSetting, setSetting } from '@/services/storage/settings'
import { updateGraphForEntry, rebuildGraph } from '@/services/graph/engine'
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
  // Graph update is cheap (DB only). Await it and mark on success: an
  // interruption leaves graph_indexed_at unset so launch catch-up heals it (via
  // a full rebuild — additive edges forbid a per-entry re-run). Awaiting also
  // means nothing is in flight when catch-up's rebuild runs. This whole function
  // is already background (callers `void` it), so the extra await costs no UX.
  const graph = await updateGraphForEntry(taggedEntry, ex.topic)
  if (graph.success) await markGraphIndexed(entry.id)

  // Wiki synthesis is the slow deep-model step — track it for the indicator.
  // Mark wiki-indexed only once synthesis resolves; an interruption leaves the
  // marker unset so catch-up re-runs the wiki step. A resolved-but-partial run
  // still counts as done — per-page model failures heal opportunistically, not
  // by re-churning every launch.
  useWikiStore.getState().begin()
  try {
    const wiki = await updateWikiForEntry(taggedEntry, ex.topic)
    if (wiki.success) await markWikiIndexed(entry.id)
  } finally {
    useWikiStore.getState().end()
  }
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

  // Pass 1: entries never tagged (extraction never ran) — full re-index.
  const untagged = await listUnindexedEntries()
  if (untagged.success) {
    // Sequential — the deep context runs one completion at a time anyway, and this
    // yields to any live save between entries.
    for (const entry of untagged.data) {
      await extractThenIndex(entry)
    }
  }

  // Pass 2: entries tagged but whose wiki synthesis was interrupted (tagged_at is
  // set before the fire-and-forget wiki step). Re-run ONLY the wiki step — tags
  // and entities are already persisted, and the graph must NOT be re-run (its
  // edges are additive and would double-count). Synced-in entries are stamped
  // wiki-indexed on pull, so they never surface here.
  const wikiPending = await listWikiPendingEntries()
  if (wikiPending.success) {
    for (const entry of wikiPending.data) {
      await wikiIndexOnly(entry)
    }
  }

  // Pass 3: entries tagged but whose graph contribution was interrupted. Unlike
  // wiki, a per-entry re-run can't heal a partial write (additive edges would
  // double-count), so heal with ONE full rebuildGraph() — a clear + re-derive
  // that's exactly-once by construction. Passes 1 and 2 above are awaited, so no
  // graph write is in flight when the rebuild runs. rebuildGraph re-derives from
  // journal entries and stamps the whole graph-pending backlog on success.
  const graphPending = await listGraphPendingEntries()
  if (graphPending.success && graphPending.data.length > 0) {
    await rebuildGraph()
  }
}

/**
 * Re-run just the wiki synthesis for an already-tagged entry and mark it done.
 * Used by catch-up for entries interrupted after tagging. Best-effort; a failed
 * synthesis leaves the marker unset so a later launch retries. Never throws.
 */
async function wikiIndexOnly(entry: Entry): Promise<void> {
  useWikiStore.getState().begin()
  try {
    const res = await updateWikiForEntry(entry, entry.topic)
    if (res.success) await markWikiIndexed(entry.id)
  } finally {
    useWikiStore.getState().end()
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
// Mentions further apart than this don't accumulate: a theme touched twice a
// year apart isn't recurring, so the pending count (and parked text) start over.
const REFLECT_MENTION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const reflectThemeKey = (theme: string) => `reflect:theme:${theme.trim().toLowerCase()}`

// Pending state for a theme still short of the recurrence gate, stored as JSON
// in local settings. Deliberately unsynced: mentions split across two devices
// don't add up — a conservative bias we accept, since syncing the counters
// would need migration + conflict handling for little gain. `first` parks the
// first mention's text — usually the fullest statement of a theme — so passing
// the gate ingests it rather than having discarded it.
interface PendingReflectTheme {
  count: number
  /** Last mention timestamp (ms) — drives the TTL reset. */
  last: number
  /** Parked first-mention text; null once ingested (or for legacy counters). */
  first: string | null
}

function parsePendingTheme(raw: string | null): PendingReflectTheme | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    // Legacy bare counter ("1") — its first-mention text was never stored, so
    // there's nothing to recover; keep the count and treat it as fresh.
    if (typeof v === 'number') return { count: v, last: Date.now(), first: null }
    if (v && typeof v === 'object' && typeof (v as PendingReflectTheme).count === 'number') {
      const p = v as { count: number; last?: unknown; first?: unknown }
      return {
        count: p.count,
        last: typeof p.last === 'number' ? p.last : 0,
        first: typeof p.first === 'string' ? p.first : null,
      }
    }
  } catch {
    // unreadable → treat as unseen
  }
  return null
}

/** Persist + index one qualifying Reflect statement. True once fully created. */
async function ingestReflectStatement(text: string, ex: EntryExtract): Promise<boolean> {
  const created = await createEntry({
    mood: moodFromScore(ex.mood_score),
    situation: text,
    thought: '',
    source: 'reflect',
  })
  if (!created.success) return false
  await indexFromExtract(created.data, ex)
  return true
}

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
  const prevRaw = await getSetting(key)
  const now = Date.now()
  let pending = prevRaw.success ? parsePendingTheme(prevRaw.data) : null
  // Mentions too far apart aren't recurrence — the count and parked text reset.
  if (pending && now - pending.last > REFLECT_MENTION_TTL_MS) pending = null

  const count = (pending?.count ?? 0) + 1
  if (count < MIN_REFLECT_MENTIONS) {
    // Park the text alongside the count: the first time someone opens up about
    // a theme is usually its fullest statement, and it must not be thrown away.
    await setSetting(key, JSON.stringify({ count, last: now, first: message }))
    return
  }

  // Gate passed: ingest the parked first mention (re-extracted for its own
  // tags/mood — one extra deep-model run, once per theme ever), then this one.
  // A failed parked ingest keeps the text parked so the next mention retries.
  let parked = pending?.first ?? null
  if (parked) {
    const parkedEx = await extractEntry({ situation: parked, thought: '' })
    if (parkedEx.success && (await ingestReflectStatement(parked, parkedEx.data))) {
      parked = null
    }
  }
  await setSetting(key, JSON.stringify({ count, last: now, first: parked }))

  await ingestReflectStatement(message, ex.data)
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
