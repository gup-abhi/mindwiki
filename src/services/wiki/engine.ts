import { synthesizePage, synthesizePageReGround, synthesizeEmotionPage, regeneratePage } from '@/services/llm/deep-model'
import { type TimingContext } from '@/types/wiki'
import * as settingsStorage from '@/services/storage/settings'
import { type Entry } from '@/services/storage/entries'
import { selectReGroundEvidence, listAllSourceEntriesForPage } from '@/services/wiki/reground-evidence'
import { listEntitiesForEntry, countEntriesForEntity, effectiveLabel } from '@/services/storage/entities'
import { listReframesForBelief } from '@/services/storage/reframes'
import {
  getPage,
  getPageByTitle,
  createPage,
  createPageWithContribution,
  updatePageCAS,
  updatePageCASWithContribution,
  updatePageCASWithContributions,
  ticklePageCount,
  regeneratePageContentWithAggregate,
  regeneratePageContent,
  listPages,
  type WikiPage,
} from '@/services/storage/wiki'
import { buildEmotionAggregate } from '@/services/wiki/aggregates'
import { stripConnectionProse } from '@/services/wiki/cleanup'
import { hasContribution, insertMissingReceipts } from '@/services/storage/wiki-contributions'
import { type Result, ok, err } from '@/types/result'

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
 *  today, never 0). Compares the local calendar date fields, while the pure
 *  timestamp inputs keep the calculation deterministic in tests. */
function calendarDayDiff(aEpochMs: number, bEpochMs: number): number {
  const a = new Date(aEpochMs)
  const b = new Date(bEpochMs)
  const aDay = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const bDay = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((bDay - aDay) / DAY_MS)
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
  const invalidEntry = !Number.isFinite(entryCreatedAt) || !Number.isFinite(now)
  const invalidPage = pageUpdatedAt != null && !Number.isFinite(pageUpdatedAt)
  const futurePage = pageUpdatedAt != null && pageUpdatedAt > now
  const isFutureEntry = invalidEntry || invalidPage || futurePage || entryCreatedAt > now
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

// ─────────────────────────────────────────────────────────────────────────────
// F-01 Slice 7b — serial synthesis queue + sourceCount-based trigger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-page Promise chain: serialises the synth + CAS-update phase so two
 * concurrent calls on the same page (tag-triggered pass + scan loop, or two
 * entries rapidly tagged) read the same `page.version` for CAS and don't both
 * fall through to the retry-once branch. Module-scoped — one chain per page id,
 * released when the chain drains.
 */
const pageSynthesisQueues = new Map<string, Promise<void>>()

async function hasCommittedContribution(entryId: string, pageId: string): Promise<boolean> {
  if (typeof hasContribution !== 'function') return false
  const receipt = await hasContribution(entryId, pageId)
  return receipt != null && receipt.success && receipt.data
}

async function applyEntryPage(
  pageId: string,
  content: string,
  baseVersion: number,
  entryId: string
): Promise<Result<{ page: WikiPage | null; affected: number; skipped?: boolean }>> {
  if (typeof updatePageCASWithContribution === 'function') {
    return updatePageCASWithContribution(pageId, content, baseVersion, {}, entryId)
  }
  const applied = await updatePageCAS(pageId, content, baseVersion, {}, undefined)
  return applied
}

function serializedPageSynthesis<T>(pageId: string, work: () => Promise<T>): Promise<T> {
  const prev = pageSynthesisQueues.get(pageId) ?? Promise.resolve()
  const cur = prev.then(work, work) // if prev rejected, still run work
  pageSynthesisQueues.set(pageId, cur.then(() => {}, () => {})) // suppress tail rejection
  return cur
}

/**
 * Source count for a page = the total number of distinct matching entries that
 * would be consulted if the page were re-ground right now. Routed through
 * `listAllSourceEntriesForPage` so it covers journal + reflect + path sources.
 * Best-effort; failure returns 0 (treated as "no fresh evidence").
 */
async function sourceCountForPage(
  title: string,
  category: string | null
): Promise<number> {
  if (category == null) return 0
  const res = await listAllSourceEntriesForPage(title, category, undefined)
  return res.success ? res.data.length : 0
}

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


async function recurringEntityTopics(entryId: string): Promise<Topic[]> {
  const res = await listEntitiesForEntry(entryId)
  if (!res.success) return []
  const out: Topic[] = []
  const seen = new Set<string>()
  for (const e of res.data) {
    // F-02B: count by EFFECTIVE label so a canonicalized alias counts toward
    // the canonical wiki page's recurrence instead of fragmenting. Two aliases
    // on one entry mapping to the same canonical contribute ONCE here too.
    const title = effectiveLabel(e)
    const dedupKey = `${e.type}:${title.toLowerCase()}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    const count = await countEntriesForEntity(e.type, title)
    if (count.success && count.data >= RECURRENCE_THRESHOLD) {
      out.push({ title, category: e.type })
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

    // A durable receipt means this entry/page contribution already committed.
    // Skip before model work so catch-up cannot re-synthesize or increment twice.
    if (page) {
      if (await hasCommittedContribution(entry.id, page.id)) continue
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

    // F-01 Slice 7b — sourceCount-based re-ground trigger: re-ground when at
    // least RE_GROUND_INTERVAL fresh matching sources exist above what was last
    // acknowledged (regrounded_upto). Replaces the old modulo-on-entry_count
    // check so source additions from reflect/catch-up/path also count.
    const sourceCount = page ? await sourceCountForPage(effectiveTitle, category) : 0
    const isReGround =
      page != null &&
      page.entry_count > 0 &&
      sourceCount - page.regrounded_upto >= RE_GROUND_INTERVAL &&
      !page.dismissed_at &&
      Date.now() - page.created_at > RE_GROUND_AGE_MS

    // Capture base version BEFORE synthesis so CAS can detect race.
    // Existing pages use CAS; new pages are protected by the DB title invariant.
    const baseVersion = page?.version ?? 0

    let synth: Result<string>
    let reGroundSourceIds: string[] | undefined
    if (isReGround) {
      // F-01 Slice 6 — all-source stratified evidence
      const allRes = await listAllSourceEntriesForPage(effectiveTitle, category, undefined)
      const corpus = allRes.success ? allRes.data : []
      // Watermark only when source selection actually returned evidence. A
      // failed/empty source read must remain due for a later retry.
      reGroundSourceIds = allRes.success && corpus.length > 0 ? corpus.map((e) => e.id) : undefined
      const historicalSamples = selectReGroundEvidence(corpus, {
        max: 6,
        excludeIds: new Set([entry.id]),
      })
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

    if (page == null) {
      const created = await createPageWithContribution(
        {
          title: topic.title,
          category: topic.category,
          content: synth.data,
          entry_count: 1,
        },
        entry.id
      )
      if (!created.success) {
        if (__DEV__) console.log(`[wiki] create failed: ${created.error.code}`)
        continue
      }
      // A uniqueness-race loser returns the existing winner without recording a
      // receipt. Retry later against that winner rather than acknowledging stale synthesis.
      if (!created.data.created) continue
      updated.push(topic.title)
      continue
    }

    const pageId = page.id
    // Existing page — serialise synth + CAS apply per page id so two concurrent
    // calls on the same page (tag-triggered pass + scan loop) see a consistent version.
    await serializedPageSynthesis(pageId, async () => {
      const casResult = reGroundSourceIds && typeof updatePageCASWithContributions === 'function'
        ? await updatePageCASWithContributions(
            pageId,
            synth.data,
            baseVersion,
            { regrounded_upto: sourceCount },
            reGroundSourceIds
          )
        : await applyEntryPage(pageId, synth.data, baseVersion, entry.id)
      if (!casResult.success) {
        if (__DEV__) console.log(`[wiki] CAS failed: ${casResult.error.code}`)
        return
      }
      if (casResult.data.affected === 1) {
        updated.push(topic.title)
        return
      }
      if (casResult.data.skipped) return

      // Stale — never apply stale content. Re-read and re-synthesize from the
      // current page, then retry CAS once. A second stale result is left for
      // later catch-up; it cannot overwrite a newer correction.
      const freshPage = await getPage(pageId, undefined)
      if (!freshPage.success || freshPage.data == null) return
      const fresh = freshPage.data
      const retrySynth = await synthesizePage({
        title: fresh.title,
        category: fresh.category ?? topic.category,
        existingContent: fresh.dismissed_at == null ? fresh.content : '',
        situation: entry.situation,
        thought: entry.thought,
        closingNote: entry.closing_note,
        behavior: entry.behavior,
        distortion: entry.distortion,
        reframe,
        timing: fresh.content
          ? computeTiming({ pageUpdatedAt: fresh.updated_at || null, entryCreatedAt: entry.created_at, now: Date.now() })
          : null,
      })
      if (!retrySynth.success) return
      const retry = reGroundSourceIds && typeof updatePageCASWithContributions === 'function'
        ? await updatePageCASWithContributions(
            pageId,
            retrySynth.data,
            fresh.version,
            { regrounded_upto: await sourceCountForPage(fresh.title, fresh.category) },
            reGroundSourceIds
          )
        : await applyEntryPage(pageId, retrySynth.data, fresh.version, entry.id)
      if (retry.success && retry.data.affected === 1) updated.push(topic.title)
    })
  }

  return ok(updated)
}

// ─────────────────────────────────────────────────────────────────────────────
// F-01 Slice 7b — scan loop for due re-ground pages
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum pages re-grounded in a single scan pass (keep it cheap). */
const SCAN_MAX_PAGES = 5

/**
 * Scan active (non-dismissed, non-merged) non-emotion wiki pages and re-ground
 * any whose source count has grown by at least RE_GROUND_INTERVAL above their
 * `regrounded_upto`. Uses the serialised per-page CAS path so a concurrent
 * entry-triggered synthesis doesn't double-write.
 *
 * The scan is best-effort — a synth failure on one page skips it and continues
 * to the next. Returns the count of pages successfully re-grounded.
 *
 * Call from a background task (e.g. after app resume, after batch catch-up).
 * Not called on every entry save (the entry-triggered path handles that).
 */
export async function scanReGroundDuePages(): Promise<Result<number>> {
  try {
    const pageList = await listPages()
    if (!pageList.success) return ok(0)

    // Filter to non-dismissed, non-merged, non-emotion pages with content.
    const candidates = pageList.data.filter(
      (p) =>
        p.dismissed_at == null &&
        p.merged_into == null &&
        p.category !== 'emotion' &&
        p.entry_count > 0 &&
        p.content.length > 0 &&
        Date.now() - p.created_at > RE_GROUND_AGE_MS
    )

    let reGrounded = 0
    for (const page of candidates) {
      if (reGrounded >= SCAN_MAX_PAGES) break

      const sourceCount = await sourceCountForPage(page.title, page.category)
      if (sourceCount - page.regrounded_upto < RE_GROUND_INTERVAL) continue

      await serializedPageSynthesis(page.id, async () => {
        const freshPage = await getPage(page.id, undefined)
        if (!freshPage.success || freshPage.data == null) return
        const p = freshPage.data

        // Double-check after acquiring the serial slot.
        const freshSourceCount = await sourceCountForPage(p.title, p.category)
        if (freshSourceCount - p.regrounded_upto < RE_GROUND_INTERVAL) return

        if (p.category == null) return
        const allRes = await listAllSourceEntriesForPage(p.title, p.category, undefined)
        const corpus = allRes.success ? allRes.data : []

        // We can't easily exclude already-receipted entries here without
        // listing receipts per page, but the stratified pick is representative
        // enough; receipt insert at the end handles dedup.
        if (corpus.length === 0) return
        const samples = selectReGroundEvidence(corpus, { max: 6 })
        if (samples.length === 0) return

        // We need a timing context. Use page's updated_at as a stand-in for
        // "last shaped" so the prompt gets a real gap.
        const timing = computeTiming({
          pageUpdatedAt: p.updated_at,
          entryCreatedAt: 0,
          now: Date.now(),
        })
        const synth = await synthesizePageReGround({
          title: p.title,
          category: p.category,
          existingContent: p.content,
          situation: '',
          thought: '',
          closingNote: null,
          behavior: null,
          distortion: null,
          reframe: null,
          timing,
          pastEntries: samples.map((e) => ({
            situation: e.situation,
            thought: e.thought,
            behavior: e.behavior,
            closing_note: e.closing_note,
            created_at: e.created_at,
          })),
        })
        if (!synth.success) return

        // CAS — entry_count stays unchanged (the scan doesn't represent a new
        // entry). Use the current entry_count as the CAS payload.
        const entryIds = corpus.map((e) => e.id)
        const casResult = typeof updatePageCASWithContributions === 'function'
          ? await updatePageCASWithContributions(
              p.id,
              synth.data,
              p.version,
              { entry_count: p.entry_count, regrounded_upto: freshSourceCount },
              entryIds
            )
          : await updatePageCAS(p.id, synth.data, p.version, { entry_count: p.entry_count })
        if (!casResult.success || casResult.data.affected === 0) return
        if (typeof updatePageCASWithContributions !== 'function') {
          await insertMissingReceipts(entryIds, p.id, undefined)
        }
        reGrounded++
      })
    }

    return ok(reGrounded)
  } catch (e) {
    return err('WIKI_REGROUND_SCAN_FAILED', 'Scan re-ground failed', e)
  }
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
  // Keep a small fallback for older test doubles/partially upgraded databases;
  // production storage uses the atomic helper.
  if (typeof settingsStorage.incrementSettingToThreshold === 'function') {
    const result = await settingsStorage.incrementSettingToThreshold(EMOTION_TRIGGER_SETTING, AGGREGATE_INTERVAL_TAGS)
    return result.success && result.data
  }
  const cur = await settingsStorage.getSetting(EMOTION_TRIGGER_SETTING)
  const n = (cur.success && cur.data ? Number(cur.data) : 0) + 1
  const reached = n >= AGGREGATE_INTERVAL_TAGS
  await settingsStorage.setSetting(EMOTION_TRIGGER_SETTING, String(reached ? 0 : n))
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

  // Content, version history, aggregated_upto, updated_at, and the sync queue
  // commit together. A synthesis/persistence failure leaves the page due.
  const applied = await regeneratePageContentWithAggregate(page.id, synth.data, page.entry_count)
  return applied.success
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
