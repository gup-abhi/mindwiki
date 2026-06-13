import { synthesizePursuitDetails } from '@/services/llm/deep-model'
import {
  createPursuit,
  listPursuits,
  updatePursuit,
  type Pursuit,
} from '@/services/storage/pursuits'

const MIN_TITLE_LEN = 3

// Phrases the small model emits when there's nothing to track — gated out so we
// don't create junk pursuits. First-person filler is dropped too.
const NON_PURSUITS = new Set([
  'none', 'nothing', 'n/a', 'na', 'unsure', 'unknown', 'nothing specific',
  'i', 'me', 'my', 'myself', 'we', 'us', 'mine', 'life',
])

/**
 * Clean a raw `working_on` phrase into a pursuit title, or null when there's
 * nothing trackable. Trims, drops trailing punctuation, rejects too-short or
 * filler phrases, caps length, and capitalizes the first letter.
 */
export function normalizePursuitTitle(raw: string): string | null {
  const t = raw.trim().replace(/[.!?]+$/, '').trim()
  if (t.length < MIN_TITLE_LEN) return null
  if (NON_PURSUITS.has(t.toLowerCase())) return null
  const capped = t.length > 80 ? t.slice(0, 80).trim() : t
  return capped.charAt(0).toUpperCase() + capped.slice(1)
}

/**
 * Find the active pursuit a title refers to, if any. Matches case-insensitively
 * on equality or containment ("Marathon" ↔ "Marathon training"), so repeated
 * mentions update one pursuit instead of spawning near-duplicates. Done/dormant
 * pursuits are ignored — re-mentioning a finished goal starts a fresh one.
 */
export function matchActivePursuit(title: string, pursuits: Pursuit[]): Pursuit | null {
  const a = title.toLowerCase()
  for (const p of pursuits) {
    if (p.status !== 'active') continue
    const b = p.title.toLowerCase()
    if (a === b) return p
    if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return p
  }
  return null
}

/**
 * Upsert a pursuit from an entry's `working_on` tag: bump (or create) it and
 * refresh its running note from the new reflection. Background, best-effort —
 * never throws, never blocks indexing. `entryText` stays on-device (used only
 * for on-device synthesis); it is never logged.
 */
export async function extractPursuit(workingOn: string, entryText: string): Promise<void> {
  const title = normalizePursuitTitle(workingOn)
  if (!title) return

  const all = await listPursuits()
  if (!all.success) return
  const existing = matchActivePursuit(title, all.data)

  if (existing) {
    const details = await synthesizePursuitDetails({
      title: existing.title,
      existingDetails: existing.details,
      entryText,
    })
    await updatePursuit(existing.id, {
      last_mentioned_at: Date.now(),
      // A fresh mention invalidates any pending check-in question; it'll be
      // regenerated from the updated note next time the pursuit is due.
      checkin_question: '',
      ...(details.success ? { details: details.data } : {}),
    })
    return
  }

  const created = await createPursuit({ title })
  if (!created.success) return
  const details = await synthesizePursuitDetails({ title, existingDetails: '', entryText })
  if (details.success) await updatePursuit(created.data.id, { details: details.data })
}
