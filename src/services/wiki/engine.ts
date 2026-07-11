import { synthesizePage, synthesizePageReGround, synthesizeEmotionPage, regeneratePage } from '@/services/llm/deep-model'
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
import { type Result, ok } from '@/types/result'

export interface Topic {
  title: string
  category: string
}

// Entities (person/place/activity) earn a wiki page only once they recur — a
// page is created/maintained when the entity has appeared in ≥2 entries. This
// keeps one-off mentions out of the wiki while the graph still shows them all.
const RECURRENCE_THRESHOLD = 2

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

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
    // How long the existing page has sat before this reflection touches it, so
    // synthesis can express evolution rather than timeless prose. Only meaningful
    // for a page with real content that was last shaped before this entry.
    const weeksSinceUpdate =
      baseContent && page
        ? Math.max(0, Math.floor((entry.created_at - page.updated_at) / WEEK_MS))
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
      if (pastEntries.length > 0 && weeksSinceUpdate != null) {
        synth = await synthesizePageReGround({
          title: effectiveTitle,
          category,
          existingContent: baseContent,
          situation: entry.situation,
          thought: entry.thought,
          distortion: entry.distortion,
          reframe,
          weeksSinceUpdate,
          pastEntries: pastEntries.map((e) => ({
            situation: e.situation,
            thought: e.thought,
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
          distortion: entry.distortion,
          reframe,
          weeksSinceUpdate,
        })
      }
    } else {
      synth = await synthesizePage({
        title: effectiveTitle,
        category,
        existingContent: baseContent,
        situation: entry.situation,
        thought: entry.thought,
        distortion: entry.distortion,
        reframe,
        weeksSinceUpdate,
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

/** Global tally of emotion taggings since last aggregate check. Resets on each
 *  scan; used to gate AGGREGATE_INTERVAL_TAGS without persisting state. */
let emotionTagTally = 0

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
    })
    if (!created.success) return
    pageId = created.data.id
  }

  // Increment the counter without rewriting content
  const tickled = await ticklePageCount(pageId)
  if (!tickled.success) return

  // Global tally: every AGGREGATE_INTERVAL_TAGS emotion taggings (any emotion)
  // triggers a scan of all due emotion pages.
  emotionTagTally++
  if (emotionTagTally >= AGGREGATE_INTERVAL_TAGS) {
    emotionTagTally = 0
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
 */
export async function maybeRefreshEmotionPages(): Promise<number> {
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

  const weeksSinceUpdate =
    page.content && page.updated_at
      ? Math.max(0, Math.floor((Date.now() - page.updated_at) / WEEK_MS))
      : null

  const synth = await synthesizeEmotionPage({
    title: page.title,
    category: 'emotion',
    existingContent: page.content,
    data,
    weeksSinceUpdate,
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
