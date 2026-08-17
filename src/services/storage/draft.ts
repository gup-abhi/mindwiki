import { type EntryDraft } from '@/types/entry'

import { getSetting, setSetting } from './settings'

// A single in-progress journal draft, persisted on-device so "save as draft on
// back" survives an app restart. Stored in the encrypted settings table (local
// only — settings never sync), so the draft body never leaves the device.

const DRAFT_KEY = 'entry_draft'

/** Persist the current draft. Best-effort — a failed write never blocks navigation. */
export async function saveDraft(draft: EntryDraft): Promise<void> {
  await setSetting(DRAFT_KEY, JSON.stringify(draft))
}

/** The saved draft, or null when there is none (or it can't be parsed). */
export async function loadDraft(): Promise<EntryDraft | null> {
  const res = await getSetting(DRAFT_KEY)
  if (!res.success || !res.data) return null
  try {
    return JSON.parse(res.data) as EntryDraft
  } catch {
    return null
  }
}

/** Drop the saved draft (on discard, or once the entry is really saved). */
export async function clearDraft(): Promise<void> {
  await setSetting(DRAFT_KEY, '')
}
