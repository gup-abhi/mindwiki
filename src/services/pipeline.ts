import { assessCrisis, type CrisisAssessment } from '@/services/crisis/detector'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
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
import { snapBeliefsSemantic } from '@/services/wiki/belief-snap'
import { getSetting, setSetting, bumpSetting } from '@/services/storage/settings'
import { updateGraphForEntry, rebuildGraph } from '@/services/graph/engine'
import { updateWikiForEntry, maybeRefreshEmotionPages } from '@/services/wiki/engine'
import { useWikiStore } from '@/store/wiki.store'
import { useSyncStore } from '@/store/sync.store'
import { announceFirstRunPageIfPending } from '@/services/onboarding/first-run'
import { sendFirstPageReadyNotification, onEntrySaved } from '@/services/notifications/scheduler'
import { reconcileNotifications, recordEntrySaved } from '@/services/notifications/orchestrator'

export interface ProcessResult {
  crisis: CrisisAssessment
}

/** Settings key for the count-only local diagnostic that tracks how often the
 * deep model produced more distinct topics than the persisted two-slot schema
 * could hold. Atomic, monotonic, label-free. No remote sync — purely a local
 * signal to the product team when model fanout starts costing entries. */
export const TOPIC_TRUNCATION_COUNT_KEY = 'topic_truncation_count'

/**
 * Drop later entries whose trimmed label case-insensitively repeats an earlier
 * one, preserving order and the first occurrence's original casing. Used to
 * collapse duplicate extracted themes (topic == topic2) before they double-count
 * in the graph recurrence gate.
 */
export function dedupeCaseInsensitive(labels: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const label of labels) {
    const key = label.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

export interface NormalizedTopics {
  topics: string[]
  truncated: boolean
}

/**
 * Pure normalization step for deep-model topics. Drops non-string / whitespace
 * entries, dedupes case-insensitively (first-occurrence casing wins), and caps
 * at `maxDistinct` distinct values. `truncated` is true only when the input
 * had MORE distinct values than the cap — a duplicate tail or short input
 * never triggers it. No DB, no async — safe to call inline in the pipeline.
 */
export function normalizeTopics(
  rawTopics: unknown[],
  maxDistinct: number = 2
): NormalizedTopics {
  const cleaned: string[] = []
  for (const t of rawTopics) {
    if (typeof t !== 'string') continue
    const trimmed = t.trim()
    if (!trimmed) continue
    cleaned.push(trimmed)
  }
  const deduped = dedupeCaseInsensitive(cleaned)
  if (deduped.length <= maxDistinct) {
    return { topics: deduped, truncated: false }
  }
  return { topics: deduped.slice(0, maxDistinct), truncated: true }
}

/**
 * Persist a deep extraction onto an entry and fan it out to the knowledge base:
 * apply the tags, persist entities (the wiki recurrence count reads them), then
 * the recurrence-gated graph + wiki synthesis. Shared by the journal flow and
 * Reflect-chat capture so there is one indexing path. Best-effort, never throws.
 */
async function indexFromExtract(entry: Entry, ex: EntryExtract): Promise<void> {
  // Dedupe the extracted themes case-insensitively before anything reads them:
  // the deep model can emit the same theme as both topic and topic2. Persisting
  // both would double-count the entry in the situation recurrence gate — the live
  // path increments the one node twice, and precomputedSupport (rebuild) sums the
  // topic + topic2 distributions, so a single entry passes the ≥2 gate. Keep the
  // first occurrence's original casing.
  //
  // Pure normalizeTopics handles dedupe-before-cap so a duplicate first value
  // (e.g. ['Work', 'work', 'Marriage']) does not discard a distinct second
  // theme. When the deep model supplies MORE distinct themes than the cap can
  // hold, we atomically bump a count-only local diagnostic — labels are never
  // stored in the counter; concurrent background indexers cannot lose
  // increments because the read+write runs in a single SQLite transaction.
  const normalized = normalizeTopics(ex.topics ?? [])
  if (normalized.truncated) {
    await bumpSetting(TOPIC_TRUNCATION_COUNT_KEY)
  }
  const primaryTopic = normalized.topics[0] ?? ''
  const secondaryTopic = normalized.topics[1] ?? ''
  await applyTags(entry.id, {
    emotion: ex.emotion,
    distortion: ex.distortion,
    mood_score: ex.mood_score,
    topic: primaryTopic,
    topic2: secondaryTopic,
  })

  // Persist entities before graph/wiki run — the graph reads them for
  // person/place/activity nodes and the wiki uses the recurrence count (which
  // must include this entry). Cheap DB write; await it.
  // Run the beliefs through the semantic-deup layer so near-synonyms ("I am not
  // good enough" / "I am inadequate") collapse to the same stored label — the
  // exact normalization already handles surface variants via canonicalizeBelief.
  const beliefs = await snapBeliefsSemantic(ex.beliefs)
  const entities: NewEntity[] = [
    ...ex.people.map((label) => ({ type: 'person' as const, label })),
    ...ex.places.map((label) => ({ type: 'place' as const, label })),
    ...ex.activities.map((label) => ({ type: 'activity' as const, label })),
    ...beliefs.map((label) => ({ type: 'belief' as const, label })),
    ...ex.behaviors.map((label) => ({ type: 'behavior' as const, label })),
  ]
  await setEntitiesForEntry(entry.id, entities)

  // Tags are now persisted. Bump the data revision so any focused screen
  // (the timeline EntryCard's "tagging…", the graph) re-reads and shows them
  // immediately — background tagging otherwise only surfaces on the next screen
  // refocus. Mirrors what a sync pull does.
  useSyncStore.getState().bumpRevision()

  const topics = normalized.topics.filter((t) => t.length > 0).slice(0, 2)
  const taggedEntry: Entry = {
    ...entry,
    emotion: ex.emotion,
    distortion: ex.distortion,
    mood_score: ex.mood_score,
    topic: primaryTopic,
    topic2: secondaryTopic,
    tagged_at: Date.now(),
  }
  // Graph update is cheap (DB only). Await it and mark on success: an
  // interruption leaves graph_indexed_at unset so launch catch-up heals it (via
  // a full rebuild — additive edges forbid a per-entry re-run). Awaiting also
  // means nothing is in flight when catch-up's rebuild runs. This whole function
  // is already background (callers `void` it), so the extra await costs no UX.
  const graph = await updateGraphForEntry(taggedEntry, topics)
  if (graph.success) await markGraphIndexed(entry.id)

  // Wiki synthesis is the slow deep-model step — track it for the indicator.
  // Mark wiki-indexed only once synthesis resolves; an interruption leaves the
  // marker unset so catch-up re-runs the wiki step. A resolved-but-partial run
  // still counts as done — per-page model failures heal opportunistically, not
  // by re-churning every launch.
  useWikiStore.getState().begin()
  try {
    const wiki = await updateWikiForEntry(taggedEntry, topics)
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

/** Best-effort emotion page scan when the deep model becomes available. */
async function updateWikiForEmotionScan(): Promise<void> {
  await maybeRefreshEmotionPages()
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

  // Deferred aha moment (P1): if the first run completed but its entries were
  // synthesized only just now (the deep model was absent during the funnel), the
  // path runner deferred. Now those entries have pages — announce once via a Home
  // banner marker + a local notification. Idempotent across passes via the marker.
  const readyPage = await announceFirstRunPageIfPending()
  if (readyPage) void sendFirstPageReadyNotification(readyPage)

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
    const themes = [entry.topic, entry.topic2].filter((t): t is string => !!t && t.length > 0)
    const res = await updateWikiForEntry(entry, themes)
    if (res.success) await markWikiIndexed(entry.id)
  } finally {
    useWikiStore.getState().end()
  }
}

/**
 * Mid-session catch-up: trigger when the deep model finishes downloading
 * during an active session. Safe to call multiple times — each pass
 * snapshots its target list so re-entry is idempotent. Best-effort, never
 * throws. Delegates directly to catchUpUnindexed, which checks model
 * presence internally (cheap file stat, fine to call redundantly).
 */
export async function triggerCatchUp(): Promise<void> {
  try {
    await catchUpUnindexed()
    // The deep model just became available for this session — a due emotion page
    // whose first aggregate was deferred (no model yet) can now be synthesised.
    // Best-effort, single-flight-guarded inside the engine; never throws.
    await updateWikiForEmotionScan()
  } catch {
    // best-effort — a failure never propagates
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
  /** Gate-passing current mention, retained until its entry is confirmed. */
  current?: string | null
}

const reflectCaptureKey = (theme: string, text: string) =>
  `reflect:capture:${bytesToHex(sha256(new TextEncoder().encode(`${theme}\n${text}`)))}`

async function ingestReflectOnce(theme: string, text: string, ex: EntryExtract): Promise<boolean> {
  const marker = await getSetting(reflectCaptureKey(theme, text))
  if (marker.success && marker.data === 'done') return true
  const ingested = await ingestReflectStatement(text, ex)
  if (!ingested) return false
  await setSetting(reflectCaptureKey(theme, text), 'done')
  return true
}

function parsePendingTheme(raw: string | null): PendingReflectTheme | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    // Legacy bare counter ("1") — its first-mention text was never stored, so
    // there's nothing to recover; keep the count and treat it as fresh.
    if (typeof v === 'number') return { count: v, last: Date.now(), first: null }
    if (v && typeof v === 'object' && typeof (v as PendingReflectTheme).count === 'number') {
      const p = v as { count: number; last?: unknown; first?: unknown; current?: unknown }
      return {
        count: p.count,
        last: typeof p.last === 'number' ? p.last : 0,
        first: typeof p.first === 'string' ? p.first : null,
        current: typeof p.current === 'string' ? p.current : null,
      }
    }
  } catch {
    // unreadable → treat as unseen
  }
  return null
}

/**
 * Persist + index one qualifying Reflect statement. True once fully created.
 * The entry's `situation` is the extract's self-contained restatement — a raw
 * chat fragment ("yeah exactly, and it's worse at night") is context-dependent
 * shorthand that would otherwise ground a permanent wiki page verbatim. The
 * message as actually typed is kept in `raw_text` for provenance; an empty
 * restatement (model didn't comply) falls back to it.
 */
async function ingestReflectStatement(text: string, ex: EntryExtract): Promise<boolean> {
  const created = await createEntry({
    mood: moodFromScore(ex.mood_score),
    situation: ex.restatement || text,
    thought: '',
    raw_text: text,
    source: 'reflect',
  })
  if (!created.success) return false
  await indexFromExtract(created.data, ex)
  return true
}

/**
 * Capture durable knowledge from a Reflect-chat message into the wiki/graph —
 * deliberately conservative so conversation noise never pollutes the knowledge
 * base. Only the user's own message reaches here (companion turns are never
 * passed in). We then: (1) extract via the deep model (which also generates a
 * restatement + topic), (2) require a real theme — topic must be non-empty and
 * non-"none", and (3) gate on recurrence — a theme is ingested only once the
 * user has stated it at least MIN_REFLECT_MENTIONS times in Reflect, never on
 * first mention. A heavy disclosure that ends in "?" isn't skipped; the
 * recurrence gate is the real noise filter, not trailing punctuation. Qualifying
 * statements are persisted as a `source:'reflect'` entry and indexed like a
 * journal entry. Background, best-effort: never throws, never blocks a reply.
 */
// Captures deferred until the conversation goes idle. Capture work runs on the
// SAME deep-model lock as the live reply (llama can't run two completions on
// one context), so an extract — or worse, a gate-pass ingest with two wiki
// syntheses — kicked off mid-chat makes the NEXT reply queue behind it for tens
// of seconds. Messages are parked here instead and processed when the user
// leaves the Reflect screen. In-memory only: an app kill mid-chat drops the
// queue, which is acceptable — capture has always been best-effort.
const pendingCaptures: { message: string; context: string | null }[] = []
let flushingCaptures = false
let capturesPaused = false
const REFLECT_CAPTURE_QUEUE_KEY = 'reflect:capture_queue'

async function readDurableCaptureQueue(): Promise<{ message: string; context: string | null }[]> {
  const stored = await getSetting(REFLECT_CAPTURE_QUEUE_KEY)
  if (!stored.success || !stored.data) return []
  try {
    const parsed: unknown = JSON.parse(stored.data)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is { message: string; context: string | null } =>
        !!item && typeof item === 'object' && typeof (item as { message?: unknown }).message === 'string'
    )
  } catch {
    return []
  }
}

/** Park a Reflect message durably for capture after conversation goes idle. */
export function queueReflectCapture(message: string, context?: string | null): void {
  const item = { message, context: context ?? null }
  pendingCaptures.push(item)
  void readDurableCaptureQueue().then((queue) => {
    if (!queue.some((entry) => entry.message === item.message && entry.context === item.context)) {
      void setSetting(REFLECT_CAPTURE_QUEUE_KEY, JSON.stringify([...queue, item]))
    }
  })
}

/**
 * The user is back in a live chat: stop draining after the current item so the
 * deep-model lock frees for replies. A capture already mid-completion can't be
 * preempted (llama has no safe cancel), so the first reply after returning can
 * still wait one item — but never the whole queue (returning mid-drain
 * previously queued the reply behind MINUTES of extracts + syntheses).
 */
export function pauseReflectCaptures(): void {
  capturesPaused = true
}

/** Chat is idle again — allow draining (call flushReflectCaptures after). */
export function resumeReflectCaptures(): void {
  capturesPaused = false
}

/**
 * Drain the deferred captures sequentially (each is extract + possible wiki
 * ingest on the deep model). Call when the chat is no longer live — on screen
 * blur. Reentrant-safe; a failure on one message never blocks the rest; stops
 * between items when paused (items stay queued for the next flush).
 */
export async function flushReflectCaptures(): Promise<void> {
  if (flushingCaptures) return
  flushingCaptures = true
  try {
    const durable = await readDurableCaptureQueue()
    for (const item of durable) {
      if (!pendingCaptures.some((entry) => entry.message === item.message && entry.context === item.context)) {
        pendingCaptures.push(item)
      }
    }
    while (pendingCaptures.length > 0 && !capturesPaused) {
      const next = pendingCaptures[0]
      try {
        await captureReflectMessage(next.message, next.context)
        pendingCaptures.shift()
        const remaining = await readDurableCaptureQueue()
        const index = remaining.findIndex((entry) => entry.message === next.message && entry.context === next.context)
        if (index >= 0) remaining.splice(index, 1)
        await setSetting(REFLECT_CAPTURE_QUEUE_KEY, JSON.stringify(remaining))
      } catch {
        // Keep failed item durable; continue with later items now and retry this
        // one on the next blur/startup.
        pendingCaptures.shift()
      }
    }
  } finally {
    flushingCaptures = false
  }
}

export async function captureReflectMessage(
  message: string,
  conversationContext?: string | null
): Promise<void> {
  // Deep extraction gives the topic (for the recurrence gate), mood, and a
  // self-contained restatement (recent turns let it resolve "it/that/this").
  // No trailing-? heuristic: a confessional "why do I always do this?" is lost
  // if we gate on punctuation. The recurrence gate (2 mentions) is the real
  // noise filter — one-off queries park at count=1, never ingress.
  const ex = await extractEntry(
    { situation: message, thought: '' },
    { restate: true, context: conversationContext }
  )
  if (!ex.success) return
  if (!ex.data.is_self_relevant) return

  const theme = ex.data.topics[0]?.trim()
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

  // Gate passed: retain both messages durably before inference/indexing. This
  // makes app-kill recovery at-least-once; per-message markers make retries
  // exactly-once for entry creation.
  let parked = pending?.first ?? null
  let current: string | null = pending?.current ?? message
  await setSetting(key, JSON.stringify({ count, last: now, first: parked, current }))

  if (parked) {
    const parkedEx = await extractEntry({ situation: parked, thought: '' }, { restate: true })
    if (parkedEx.success && (await ingestReflectOnce(theme, parked, parkedEx.data))) parked = null
  }

  const currentEx = current === message ? ex : await extractEntry({ situation: current, thought: '' }, { restate: true })
  if (currentEx.success && (await ingestReflectOnce(theme, current, currentEx.data))) current = null

  await setSetting(key, JSON.stringify({ count, last: now, first: parked, current }))
}

export interface PathCaptureResult {
  crisis: CrisisAssessment
  /** The IDs of the created path entries, in order. Empty when all answers were blank. */
  entryIds: string[]
}

/**
 * Capture the answers from a completed guided path. Each non-empty answer becomes
 * its own `source:'path'` entry, indexed into the wiki/graph immediately — no
 * recurrence gate (unlike Reflect chat): the user deliberately chose this
 * reflection, it isn't incidental. Path entries stay out of the journal timeline
 * (which filters `source='journal'`) but compound the knowledge base like any entry.
 *
 * Returns the crisis assessment (for /crisis routing) AND the created entry IDs
 * (for first-run wiki-page routing). The crisis score is the only blocking step;
 * indexing is background. Never throws.
 */
export async function capturePathAnswers(answers: string[]): Promise<PathCaptureResult> {
  const nonEmpty = answers.map((a) => a.trim()).filter((a) => a !== '')
  if (nonEmpty.length === 0) return { crisis: assessCrisis('', 0), entryIds: [] }

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

  // Arm the habit loop: a completed path is a deliberate act of reflection, so it
  // records local activity and asks central reconciler to converge notification
  // state, matching journal saves. Fire-and-forget — never blocks completion.
  void onEntrySaved(Date.now())
  void recordEntrySaved()
  void reconcileNotifications('entry-saved')

  return { crisis, entryIds: created.map((e) => e.id) }
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
