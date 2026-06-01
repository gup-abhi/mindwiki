import { synthesizePage } from '@/services/llm/deep-model'
import { type Entry } from '@/services/storage/entries'
import { getPageByTitle, createPage, updatePage } from '@/services/storage/wiki'
import { type Result, ok } from '@/types/result'

export interface Topic {
  title: string
  category: string
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
  if (__DEV__) console.log(`[wiki] topics: ${topics.map((t) => t.title).join(', ') || '(none)'}`)

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

    if (__DEV__) console.log(`[wiki] synthesizing "${page.title}"…`)
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
      if (__DEV__) console.log(`[wiki] updated "${page.title}" -> v${applied.data.version}`)
      updated.push(page.title)
    } else if (__DEV__) {
      console.log(`[wiki] update failed: ${applied.error.code}`)
    }
  }

  return ok(updated)
}
