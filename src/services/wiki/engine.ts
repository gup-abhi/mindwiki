import { synthesizePage, regeneratePage } from '@/services/llm/deep-model'
import { type Entry } from '@/services/storage/entries'
import { listEntitiesForEntry, countEntriesForEntity } from '@/services/storage/entities'
import { listReframesForBelief } from '@/services/storage/reframes'
import {
  getPage,
  getPageByTitle,
  createPage,
  updatePage,
  regeneratePageContent,
  type WikiPage,
} from '@/services/storage/wiki'
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

    // Synthesize first. A failed synthesis must never leave a blank, 0-entry
    // page behind (it would surface as an empty wiki page), so a brand-new page
    // is only created once we actually have content for it.
    // A dropped page was flagged as inaccurate — don't build on its content.
    // Regenerate from scratch on this entry; updatePage then clears the flag.
    const baseContent = page && page.dismissed_at == null ? page.content : ''
    // Synthesize under the resolved page's own title (a merged loser resolves to
    // the survivor, whose title differs from this entry's topic).
    const effectiveTitle = page?.title ?? topic.title
    const category = page?.category ?? topic.category
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
    const synth = await synthesizePage({
      title: effectiveTitle,
      category,
      existingContent: baseContent,
      situation: entry.situation,
      thought: entry.thought,
      distortion: entry.distortion,
      reframe,
      weeksSinceUpdate,
    })
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
