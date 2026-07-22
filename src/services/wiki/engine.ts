import { synthesizePage, synthesizePageReGround, synthesizeEmotionPage, regeneratePage } from '@/services/llm/deep-model'
import { type TimingContext } from '@/types/wiki'
import { getSetting, setSetting } from '@/services/storage/settings'
import {
  type Entry,
  listEntriesByEmotion,
  listEntriesByDistortion,
  listEntriesByTopicOrTopic2,
  listEntriesForEntity,
} from '@/services/storage/entries'
import { listEntitiesForEntry, countEntriesForEntity } from '@/services/storage/entities'
import { listReframesForBelief } from '@/services/storage/reframes'
import {
  getPage,
  getPageByTitle,
  createPage,
  updatePage,
  ticklePageCount,
  setAggregatedUpto,
  regeneratePageContent,
  listPages,
  type WikiPage,
} from '@/services/storage/wiki'
import { buildEmotionAggregate } from '@/services/wiki/aggregates'
import { stripConnectionProse } from '@/services/wiki/cleanup'
import { type Result, ok } from '@/types/result'

export interface Topic {
  title: string
  category: string
}

// Entities (person/place/activity) earn a wiki page only once they recur — a
// page is created/maintained when the entity has appeared in ≥2 entries. This
// keeps one-off mentions out of the wiki while the graph still shows them all.
const RECURRENCE_THRESHOLD = 2

const DAY_MS = 24 * 60 * 60 * 1000

// Re-export the shared timing context type from the type leaf so consumers can
// continue to import it from the wiki engine surface (where computeTiming
// lives) without depending on the prompt builder. See `@/types/wiki`.
export type { TimingContext }

/** Calendar-day difference between two epoch-ms timestamps, floor-bucketed:
 *  Midnight-crossings land on separate days even when only 1 wall-second apart
 *  (so a reflection written at 23:59 last night is "1 day old" at 00:01
 *  today, never 0). Uses UTC-midnight bucketing so this is timezone-stable and
 *  deterministic — the same clocks used by the prompt-builder tests. */
function calendarDayDiff(aEpochMs: number, bEpochMs: number): number {
  const aDay = Math.floor(aEpochMs / DAY_MS)
  const bDay = Math.floor(bEpochMs / DAY_MS)
  return bDay - aDay // b minus a (e.g. age = calendarDayDiff(createdAt, now))
}

/** Compute a {@link TimingContext} from the page's latest shaping, the
 *  entry's creation time, and the current processing time. Pure — no
 *  Date.now() — so the suite can be wall-clock-independent. */
export function computeTiming(args: {
  pageUpdatedAt: number | null
  entryCreatedAt: number
  now: number
}): TimingContext {
  const { pageUpdatedAt, entryCreatedAt, now } = args
  const isFutureEntry = entryCreatedAt > now
  if (isFutureEntry) {
    return { gapDays: null, entryAgeDays: null, isHistoricalEntry: false, isFutureEntry: true }
  }
  const entryAgeDays = calendarDayDiff(entryCreatedAt, now) // now - createdAt (>=0)
  if (pageUpdatedAt == null) {
    return { gapDays: null, entryAgeDays, isHistoricalEntry: false, isFutureEntry: false }
  }
  if (entryCreatedAt >= pageUpdatedAt) {
    // Entry NEWER than the page's last shaping — the classic "page has gone
    // quiet" case where evolution framing is legitimate. gapDays measured from
    // the page's last shaping to THIS entry (calendar-day diff).
    const gapDays = calendarDayDiff(pageUpdatedAt, entryCreatedAt)
    return { gapDays, entryAgeDays, isHistoricalEntry: false, isFutureEntry: false }
  }
  // Entry predates the page's last shaping — historical evidence the page
  // already incorporates a later understanding of. Suppress evolution framing.
  return { gapDays: null, entryAgeDays, isHistoricalEntry: true, isFutureEntry: false }
}

// Re-grounding interval: every 10 entries the page synthesises from source
// entries rather than the incremental telephone chain. Smooths drift while
// keeping 90% of passes cheap (no extra entry queries).
const RE_GROUND_INTERVAL = 10
// A page must exist at least this long before its first re-ground, so a brand-
// new page with content from its first 10 entries doesn't double-synthesise.
const RE_GROUND_AGE_MS = 24 * 60 * 60 * 1000

// Emotion aggregate interval: after every N total emotion taggings (any
// emotion), scan all emotion pages for aggregate synthesis due.
const AGGREGATE_INTERVAL_TAGS = 20
// Minimum entry_count before an emotion page gets its first aggregate.
const AGGREGATE_MIN_ENTRIES = 5
// Minimum age before first aggregate, so a brand-new page isn't immediately
// synthesised — there's no history to aggregate from.
const AGGREGATE_MIN_AGE_MS = 24 * 60 * 60 * 1000
// How many new entries are needed since the last aggregate to re-synthesise.
const AGGREGATE_BATCH_SIZE = 10

/**
 * Sample recent entries that shaped a wiki page, for a re-grounding pass.
 * Routes by category to the right storage query. Returns up to K entries,
 * newest first. Best-effort — returns empty on any failure so the caller
 * falls through to normal incremental synthesis.
 */
async function sampleEntriesForPage(
  title: string,
  category: string,
  maxEntries: number
): Promise<Entry[]> {
  const queries: Record<string, () => Promise<Result<Entry[]>>> = {
    emotion: () => listEntriesByEmotion(title),
    distortion: () => listEntriesByDistortion(title),
    theme: () => listEntriesByTopicOrTopic2(title),
  }
  // Entity categories route through the entity join table
  const entityTypes = ['person', 'place', 'activity', 'belief', 'behavior']
  const q = entityTypes.includes(category)
    ? () => listEntriesForEntity(category as any, title)
    : queries[category]
  if (!q) return []
  const res = await q()
  return res.success ? res.data.slice(0, maxEntries) : []
}

async function recurringEntityTopics(entryId: string): Promise<Topic[]> {
  const res = await listEntitiesForEntry(entryId)
  if (!res.success) return []
  const out: Topic[] = []
  for (const e of res.data) {
    const count = await countEntriesForEntity(e.type, e.label)
    if (count.success && count.data >= RECURRENCE_THRESHOLD) {
      out.push({ title: e.label, category: e.type })
    }
  }
  return out
}

function titleCase(s: string): string {
  const t = s.trim()
  return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/**
 * Follow a page's merged_into pointer to the surviving page, so a topic that was
 * semantically merged resolves to its survivor. getPageByTitle matches on title
 * alone and does NOT filter merged pages, so without this a future entry tagged
 * with the merged (loser) title would re-synthesize into the hidden page. Guards
 * against a broken/cyclic chain. Returns the page itself if it isn't merged.
 */
async function resolveSurvivor(page: WikiPage | null): Promise<WikiPage | null> {
  let cur = page
  for (let hops = 0; cur && cur.merged_into && hops < 10; hops++) {
    const next = await getPage(cur.merged_into)
    if (!next.success || !next.data) break
    cur = next.data
  }
  return cur
}

/**
 * Wiki page topics an entry contributes to: emotion + distortion (from the
 * persisted tags) plus optional themes (1–2, from the deep-model extract).
 * De-duplicated by title.
 */
export function candidateTopics(entry: Entry, topics?: string[] | null): Topic[] {
  const topicsList: Topic[] = []
  const seen = new Set<string>()
  const add = (raw: string, category: string) => {
    const title = titleCase(raw)
    const key = title.toLowerCase()
    if (title && !seen.has(key)) {
      seen.add(key)
      topicsList.push({ title, category })
    }
  }
  if (entry.emotion && entry.emotion.trim()) add(entry.emotion, 'emotion')
  if (entry.distortion && entry.distortion.trim().toLowerCase() !== 'none') {
    add(entry.distortion, 'distortion')
  }
  if (topics) {
    for (const t of topics) {
      if (t && t.trim()) add(t, 'theme')
    }
  }
  return topicsList
}

/**
 * For each topic the entry touches: get-or-create the page, synthesize updated
 * content with the deep model, and apply it (versioned). Best-effort and never
 * throws — a failure on one page skips it without affecting the others or the
 * entry. Returns the titles successfully updated.
 */
export async function updateWikiForEntry(
  entry: Entry,
  topics?: string[] | null
): Promise<Result<string[]>> {
  const updated: string[] = []
  const topicList = candidateTopics(entry, topics)
  // Add recurring people/places/activities, skipping any title already covered
  // by an emotion/distortion/theme topic (get-or-create matches on title alone).
  const seen = new Set(topicList.map((t) => t.title.toLowerCase()))
  for (const t of await recurringEntityTopics(entry.id)) {
    if (seen.has(t.title.toLowerCase())) continue
    seen.add(t.title.toLowerCase())
    topicList.push(t)
  }

  for (const topic of topicList) {
    const existing = await getPageByTitle(topic.title)
    if (!existing.success) continue
    // If this title was merged into another page, build on the survivor instead
    // of re-synthesizing into the hidden (merged) page.
    const page = await resolveSurvivor(existing.data)

    // Emotion pages use periodic aggregate synthesis, not per-entry rewrites.
    // Just increment the counter and schedule a future aggregate.
    const category = page?.category ?? topic.category
    if (category === 'emotion') {
      await tickleEmotionPage(entry, topic, page)
      continue
    }

    // Synthesize first. A failed synthesis must never leave a blank, 0-entry
    // page behind (it would surface as an empty wiki page), so a brand-new page
    // is only created once we actually have content for it.
    // A dropped page was flagged as inaccurate — don't build on its content.
    // Regenerate from scratch on this entry; updatePage then clears the flag.
    const baseContent = page && page.dismissed_at == null ? page.content : ''
    // Synthesize under the resolved page's own title (a merged loser resolves to
    // the survivor, whose title differs from this entry's topic).
    const effectiveTitle = page?.title ?? topic.title
    // For a belief page, fold in the writer's latest reframe so the synthesis
    // reflects how they're revising the belief — not just restating it.
    let reframe: string | null = null
    if (category === 'belief') {
      const rf = await listReframesForBelief(topic.title)
      if (rf.success && rf.data.length > 0) reframe = rf.data[0].balanced_thought
    }
    // F-4 — deterministic timing context (calendar-day gaps) for time-accurate
    // recency wording. Only meaningful when the page has real prior content
    // that was last shaped before this entry; otherwise `gapDays` is null and
    // the prompt emits no evolution framing (daily/first-time journaling stays
    // silent). See `computeTiming` in this module — it owns the math.
    const timing =
      baseContent && page
        ? computeTiming({
            pageUpdatedAt: page.updated_at || null,
            entryCreatedAt: entry.created_at,
            now: Date.now(),
          })
        : null

    // Re-grounding: every RE_GROUND_INTERVAL entries, synthesise from source
    // entries instead of the incremental telephone chain. Resets drift to zero.
    const isReGround =
      page != null &&
      page.entry_count > 0 &&
      page.entry_count % RE_GROUND_INTERVAL === 0 &&
      !page.dismissed_at &&
      Date.now() - page.created_at > RE_GROUND_AGE_MS

    let synth: Result<string>
    if (isReGround) {
      const pastEntries = await sampleEntriesForPage(effectiveTitle, category, 6)
      // The current entry may also appear in the historical sample query. Exclude
      // it from the past-evidence block before adding the dedicated current-entry
      // block, so its evidence isn't double-counted.
      const historicalSamples = pastEntries.filter((e) => e.id !== entry.id)
      if (historicalSamples.length > 0 && timing != null) {
        synth = await synthesizePageReGround({
          title: effectiveTitle,
          category,
          existingContent: baseContent,
          situation: entry.situation,
          thought: entry.thought,
          closingNote: entry.closing_note,
          behavior: entry.behavior,
          distortion: entry.distortion,
          reframe,
          timing,
          pastEntries: historicalSamples.map((e) => ({
            situation: e.situation,
            thought: e.thought,
            behavior: e.behavior,
            closing_note: e.closing_note,
            created_at: e.created_at,
          })),
        })
      } else {
        // No past entries to ground from — fall through to normal synthesis
        synth = await synthesizePage({
          title: effectiveTitle,
          category,
          existingContent: baseContent,
          situation: entry.situation,
          thought: entry.thought,
          closingNote: entry.closing_note,
          behavior: entry.behavior,
          distortion: entry.distortion,
          reframe,
          timing,
        })
      }
    } else {
      synth = await synthesizePage({
        title: effectiveTitle,
        category,
        existingContent: baseContent,
        situation: entry.situation,
        thought: entry.thought,
        closingNote: entry.closing_note,
        behavior: entry.behavior,
        distortion: entry.distortion,
        reframe,
        timing,
      })
    }
    if (!synth.success) {
      if (__DEV__) console.log(`[wiki] synth failed: ${synth.error.code}`)
      continue
    }

    let pageId = page?.id
    if (pageId == null) {
      const created = await createPage({ title: topic.title, category: topic.category })
      if (!created.success) {
        if (__DEV__) console.log(`[wiki] create failed: ${created.error.code}`)
        continue
      }
      pageId = created.data.id
    }

    const applied = await updatePage(pageId, synth.data)
    if (applied.success) {
      updated.push(topic.title)
    } else if (__DEV__) {
      console.log(`[wiki] update failed: ${applied.error.code}`)
    }
  }

  return ok(updated)
}

/** A live wiki page an entry contributed to, for the entry-detail lineage. */
export interface LineagePage {
  id: string
  title: string
  category: string | null
}

/**
 * The live wiki pages this entry shaped — its emotion, distortion, and theme
 * topics, plus any recurring people/places/activities that have earned a page.
 * Dropped (dismissed) pages are excluded. Lets the entry detail surface the
 * compounding knowledge the entry fed. Best-effort; never throws.
 */
export async function lineageForEntry(entry: Entry): Promise<Result<LineagePage[]>> {
  // Build topic list from primary + secondary themes, both persisted on entry.
  const themes = [entry.topic, entry.topic2].filter((t): t is string => !!t && t.trim().length > 0)
  const topics = candidateTopics(entry, themes)
  const seen = new Set(topics.map((t) => t.title.toLowerCase()))
  for (const t of await recurringEntityTopics(entry.id)) {
    if (seen.has(t.title.toLowerCase())) continue
    seen.add(t.title.toLowerCase())
    topics.push(t)
  }

  const out: LineagePage[] = []
  const seenPageIds = new Set<string>()
  for (const t of topics) {
    const res = await getPageByTitle(t.title)
    if (!res.success) continue
    // Resolve merged topics to their survivor so lineage points at the live page.
    const page = await resolveSurvivor(res.data)
    if (page && page.dismissed_at == null && !seenPageIds.has(page.id)) {
      seenPageIds.add(page.id)
      out.push({ id: page.id, title: page.title, category: page.category })
    }
  }
  return ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// Emotion aggregate routing
// ─────────────────────────────────────────────────────────────────────────────

/** Durable settings key for the emotion-tag trigger count. Persists across
 *  restarts so an app kill mid-count-down doesn't discard progress toward the
 *  next aggregate scan. */
const EMOTION_TRIGGER_SETTING = 'maintenance:emotion_trigger_count'

/** In-flight promise for the current emotion scan, so overlapping callers await
 *  one scan instead of starting a second (single-flight). Reset to null once the
 *  scan resolves. Module-scoped — one scan runs per process at a time. */
let emotionScanInFlight: Promise<number> | null = null

/**
 * Persistently increment the global emotion-tag trigger count and atomically
 * decide whether it reached the scan threshold. On reaching AGGREGATE_INTERVAL_TAGS
 * the count resets to 0 in the same write so a concurrent tickle can't double-fire.
 * Best-effort: a settings read/write failure leaves the count unchanged (next
 *  tickle retries) — never throws, never blocks the tickle.
 */
async function incrementEmotionTrigger(): Promise<boolean> {
  const cur = await getSetting(EMOTION_TRIGGER_SETTING)
  const n = (cur.success && cur.data ? Number(cur.data) : 0) + 1
  const reached = n >= AGGREGATE_INTERVAL_TAGS
  await setSetting(EMOTION_TRIGGER_SETTING, String(reached ? 0 : n))
  return reached
}

/**
 * First-touch placeholder for a new emotion page. Emotion pages are synthesised
 * in periodic aggregate batches, not per entry, so a page can sit for several
 * entries (and up to AGGREGATE_MIN_AGE_MS) before its first real synthesis.
 * Without seed content it would surface as a blank page in the wiki; this warm
 * one-liner stands in until the first aggregate replaces it.
 */
function emotionPlaceholder(title: string): string {
  return `You've just started noticing ${title.toLocaleLowerCase()}. As you write more about when it shows up and what surrounds it, this page will grow into a picture of your patterns with it.`
}

/**
 * Tickle an emotion page: create the page if it doesn't exist yet (with a
 * placeholder), increment the counter, and check whether the global trigger
 * should fire an aggregate scan.
 */
async function tickleEmotionPage(
  entry: Entry,
  topic: Topic,
  page: WikiPage | null
): Promise<void> {
  // Create the page if missing — placeholder content prevents a blank entry
  // in the wiki list while the page waits for its first aggregate.
  let pageId = page?.id
  if (pageId == null) {
    const created = await createPage({
      title: topic.title,
      category: 'emotion',
      content: emotionPlaceholder(topic.title),
    })
    if (!created.success) return
    pageId = created.data.id
  }

  // Increment the counter without rewriting content
  const tickled = await ticklePageCount(pageId)
  if (!tickled.success) return

  // Global tally: every AGGREGATE_INTERVAL_TAGS emotion taggings (any emotion)
  // triggers a scan of all due emotion pages. Durable across restarts.
  if (await incrementEmotionTrigger()) {
    await maybeRefreshEmotionPages()
  }
}

/**
 * Scan every active emotion page and re-synthesise any that are due for an
 * aggregate update. A page is due when:
 *  - entry_count >= AGGREGATE_MIN_ENTRIES (enough data)
 *  - entry_count - aggregated_upto >= AGGREGATE_BATCH_SIZE (enough new data)
 *  - The page is older than AGGREGATE_MIN_AGE_MS (has history to aggregate)
 *  - The page is active (not dismissed, not merged)
 *
 * The age gate is on created_at, NOT updated_at: an emotion page is tickled
 * (its updated_at bumped) on every tagging, so gating on updated_at would
 * permanently block the daily-touched high-traffic pages this feature targets.
 *
 * Best-effort — one page failure does not affect the others. Returns the
 * number of pages refreshed (for test assertions).
 *
 * Single-flight: a scan already in progress is shared by overlapping callers
 * (they await the SAME promise), so two near-simultaneous trigger events run
 * one synthesis per due page, never two.
 */
export function maybeRefreshEmotionPages(): Promise<number> {
  if (emotionScanInFlight) return emotionScanInFlight
  emotionScanInFlight = runEmotionScan()
  // Always clear the lock on settle so a later trigger can run a fresh scan.
  emotionScanInFlight.finally(() => { emotionScanInFlight = null })
  return emotionScanInFlight
}

/** The actual scan loop. Owned by the single-flight wrapper above. */
async function runEmotionScan(): Promise<number> {
  const pagesRes = await listPages()
  if (!pagesRes.success) return 0

  let refreshed = 0
  const now = Date.now()
  for (const page of pagesRes.data) {
    if (page.category !== 'emotion') continue
    if (page.entry_count < AGGREGATE_MIN_ENTRIES) continue
    if (page.entry_count - (page.aggregated_upto ?? 0) < AGGREGATE_BATCH_SIZE) continue
    if (now - page.created_at < AGGREGATE_MIN_AGE_MS) continue

    const ok = await refreshSingleEmotionPage(page)
    if (ok) refreshed++
  }
  return refreshed
}

/**
 * Build the aggregate for one emotion page, synthesise new content, and update
 * the page. Returns true on success, false on any failure.
 */
async function refreshSingleEmotionPage(page: WikiPage): Promise<boolean> {
  const aggRes = await buildEmotionAggregate(page.title)
  if (!aggRes.success || !aggRes.data) return false

  const data = aggRes.data
  if (data.totalCount === 0) return false

  // F-4 — emotion aggregate has no single source entry; treat the
  // aggregate pass as "now" entryCreatedAt (=processing time) so the timing
  // only conveys "how long the page sat dark before this re-aggregate".
  // Suppress evolution-day-age wording (there is no dated reflection here).
  const emotionTiming =
    page.content && page.updated_at
      ? computeTiming({
          pageUpdatedAt: page.updated_at,
          entryCreatedAt: Date.now(),
          now: Date.now(),
        })
      : null

  const synth = await synthesizeEmotionPage({
    title: page.title,
    category: 'emotion',
    existingContent: page.content,
    data,
    timing: emotionTiming,
  })
  if (!synth.success) return false

  const applied = await regeneratePageContent(page.id, synth.data)
  if (!applied.success) return false

  // Mark the aggregated_upto so we know where we left off. After a successful
  // aggregate, reset the marker to the current entry_count (which is unchanged
  // by regeneratePageContent). The next aggregate fires when AGGREGATE_BATCH_SIZE
  // new entries have tickled the page.
  await setAggregatedUpto(page.id, applied.data.entry_count)
  return true
}


/** Progress event emitted per page during a connection-prose cleanup, so a
 *  caller (e.g. the dev UI) can show live status instead of one final dump.
 *  index/total are 1-based over the changed pages only. */
export interface CleanupProgress {
  title: string
  index: number
  total: number
  status: 'start' | 'done' | 'failed'
}

/**
 * One-time cleanup: strip the connection-line prose (and the "knowledge graph
 * shows" scaffold leak) that the old "connections in synthesis prose" approach
 * baked into already-stored page content. Connections now render as a
 * deterministic structured block (WikiConnections) and never live in
 * page.content, so each active page with stale connection prose is rewritten
 * deterministically — no LLM call — and persisted via regeneratePageContent
 * (versions the page, enqueues sync). Best-effort: returns the titles
 * successfully cleaned. Never throws.
 *
 * Optionally reports per-page progress via onProgress — a 'start' before each
 * page is cleaned and a 'done'/'failed' after — so the UI updates in real time
 * rather than waiting for the whole run to finish.
 */
export async function cleanupConnectionProse(
  onProgress?: (p: CleanupProgress) => void
): Promise<Result<string[]>> {
  const pagesRes = await listPages()
  if (!pagesRes.success) return ok([])

  // Resolve eligibility up front so progress index/total span only the pages
  // that actually carry stale connection prose (a caller shows "2 of 5", not
  // "2 of 40").
  const eligible = pagesRes.data
    .map((page) => ({ page, cleaned: stripConnectionProse(page.content) }))
    .filter((e) => e.cleaned !== e.page.content)

  const updated: string[] = []
  const total = eligible.length
  for (let i = 0; i < total; i++) {
    const { page, cleaned } = eligible[i]
    onProgress?.({ title: page.title, index: i + 1, total, status: 'start' })

    const applied = await regeneratePageContent(page.id, cleaned)
    if (applied.success) {
      updated.push(page.title)
      onProgress?.({ title: page.title, index: i + 1, total, status: 'done' })
    } else {
      onProgress?.({ title: page.title, index: i + 1, total, status: 'failed' })
    }
  }

  return ok(updated)
}

/**
 * One-time backfill: seed active emotion pages that were created blank (before
 * the first-touch placeholder existed) with the placeholder text, so they no
 * longer surface as empty pages in the wiki list. Deterministic — no LLM call.
 * A seeded page is still replaced by its first real aggregate synthesis once it
 * clears the aggregate gates; this only fills the gap until then. Skips
 * dismissed and merged pages. Best-effort: returns the titles seeded, never
 * throws. Optionally reports per-page progress via onProgress.
 */
export async function backfillEmotionPlaceholders(
  onProgress?: (p: CleanupProgress) => void
): Promise<Result<string[]>> {
  const pagesRes = await listPages()
  if (!pagesRes.success) return ok([])

  const eligible = pagesRes.data.filter(
    (page) =>
      page.category === 'emotion' &&
      page.content.trim() === '' &&
      page.dismissed_at == null &&
      page.merged_into == null
  )

  const updated: string[] = []
  const total = eligible.length
  for (let i = 0; i < total; i++) {
    const page = eligible[i]
    onProgress?.({ title: page.title, index: i + 1, total, status: 'start' })

    const applied = await regeneratePageContent(page.id, emotionPlaceholder(page.title))
    if (applied.success) {
      updated.push(page.title)
      onProgress?.({ title: page.title, index: i + 1, total, status: 'done' })
    } else {
      onProgress?.({ title: page.title, index: i + 1, total, status: 'failed' })
    }
  }

  return ok(updated)
}

/**
 * Rewrite a single page in the canonical voice (substance unchanged) and persist
 * it, versioned. Used to bring pages written before the voice was pinned into a
 * consistent voice. Returns the updated page.
 */
export async function regeneratePageVoice(page: WikiPage): Promise<Result<WikiPage>> {
  const synth = await regeneratePage({
    title: page.title,
    category: page.category,
    content: page.content,
  })
  if (!synth.success) return synth
  return regeneratePageContent(page.id, synth.data)
}
