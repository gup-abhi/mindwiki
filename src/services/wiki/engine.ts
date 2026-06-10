import { synthesizePage } from '@/services/llm/deep-model'
import { type Entry } from '@/services/storage/entries'
import { listEntitiesForEntry, countEntriesForEntity } from '@/services/storage/entities'
import { getPageByTitle, createPage, updatePage } from '@/services/storage/wiki'
import { type Result, ok } from '@/types/result'

export interface Topic {
  title: string
  category: string
}

// Entities (person/place/activity) earn a wiki page only once they recur — a
// page is created/maintained when the entity has appeared in ≥2 entries. This
// keeps one-off mentions out of the wiki while the graph still shows them all.
const RECURRENCE_THRESHOLD = 2

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
 * Wiki page topics an entry contributes to: emotion + distortion (from the
 * persisted tags) plus an optional theme/topic (transient, from the fast model).
 * De-duplicated by title.
 */
export function candidateTopics(entry: Entry, topic?: string | null): Topic[] {
  const topics: Topic[] = []
  const seen = new Set<string>()
  const add = (raw: string, category: string) => {
    const title = titleCase(raw)
    const key = title.toLowerCase()
    if (title && !seen.has(key)) {
      seen.add(key)
      topics.push({ title, category })
    }
  }
  if (entry.emotion && entry.emotion.trim()) add(entry.emotion, 'emotion')
  if (entry.distortion && entry.distortion.trim().toLowerCase() !== 'none') {
    add(entry.distortion, 'distortion')
  }
  if (topic && topic.trim()) add(topic, 'theme')
  return topics
}

/**
 * For each topic the entry touches: get-or-create the page, synthesize updated
 * content with the deep model, and apply it (versioned). Best-effort and never
 * throws — a failure on one page skips it without affecting the others or the
 * entry. Returns the titles successfully updated.
 */
export async function updateWikiForEntry(
  entry: Entry,
  topic?: string | null
): Promise<Result<string[]>> {
  const updated: string[] = []
  const topics = candidateTopics(entry, topic)
  // Add recurring people/places/activities, skipping any title already covered
  // by an emotion/distortion/theme topic (get-or-create matches on title alone).
  const seen = new Set(topics.map((t) => t.title.toLowerCase()))
  for (const t of await recurringEntityTopics(entry.id)) {
    if (seen.has(t.title.toLowerCase())) continue
    seen.add(t.title.toLowerCase())
    topics.push(t)
  }

  for (const topic of topics) {
    const existing = await getPageByTitle(topic.title)
    if (!existing.success) continue

    let page = existing.data
    if (page == null) {
      const created = await createPage({ title: topic.title, category: topic.category })
      if (!created.success) {
        if (__DEV__) console.log(`[wiki] create failed: ${created.error.code}`)
        continue
      }
      page = created.data
    }

    const synth = await synthesizePage({
      title: page.title,
      category: page.category,
      existingContent: page.content,
      situation: entry.situation,
      thought: entry.thought,
    })
    if (!synth.success) {
      if (__DEV__) console.log(`[wiki] synth failed: ${synth.error.code}`)
      continue
    }

    const applied = await updatePage(page.id, synth.data)
    if (applied.success) {
      updated.push(page.title)
    } else if (__DEV__) {
      console.log(`[wiki] update failed: ${applied.error.code}`)
    }
  }

  return ok(updated)
}
