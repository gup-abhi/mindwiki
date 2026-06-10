import { useCallback, useState } from 'react'

import { type CrisisAssessment } from '@/services/crisis/detector'
import { onEntrySaved } from '@/services/notifications/scheduler'
import { processEntry } from '@/services/pipeline'
import { createEntry, type Entry } from '@/services/storage/entries'
import { sync } from '@/services/sync/engine'
import { useAuthStore } from '@/store/auth.store'
import { useEntryStore } from '@/store/entry.store'
import { type Result, ok, err } from '@/types/result'

export interface SubmitOutcome {
  entry: Entry
  crisis: CrisisAssessment
}

/**
 * Drives the free-write entry: a mood + the body the user writes, with an
 * optional automatic-thought facet. The body is the entry text (stored as
 * `situation`); the fast model derives the rest after save. A failed submit
 * never throws — returns Result.
 */
export function useJournalEntry() {
  const draft = useEntryStore((s) => s.draft)
  const setMood = useEntryStore((s) => s.setMood)
  const setBody = useEntryStore((s) => s.setBody)
  const setThought = useEntryStore((s) => s.setThought)
  const reset = useEntryStore((s) => s.reset)

  const [submitting, setSubmitting] = useState(false)

  const canSave = draft.mood != null && draft.body.trim().length > 0

  const submit = useCallback(async (): Promise<Result<SubmitOutcome>> => {
    if (draft.mood == null) return err('ENTRY_INVALID', 'Choose how you’re feeling first')
    if (draft.body.trim().length === 0) return err('ENTRY_INVALID', 'Write something first')

    setSubmitting(true)
    try {
      const result = await createEntry({
        mood: draft.mood,
        situation: draft.body.trim(), // the free-write body is the entry text
        thought: draft.thought.trim(), // optional CBT facet ('' if not added)
        behavior: null,
        closing_note: null,
      })
      if (!result.success) return result

      // The entry is already persisted. Run tag + crisis assessment and surface
      // the result so the caller can show crisis support. processEntry never
      // throws; if the model is unavailable, the keyword safety net still runs.
      const processed = await processEntry(result.data)
      // Habit system: permission (first entry only), activity, reminder.
      // Best-effort — never blocks the save.
      void onEntrySaved(Date.now())
      // Push the new entry promptly instead of waiting for the next foreground.
      // Best-effort; sync() no-ops when unauthenticated and never throws.
      if (useAuthStore.getState().status === 'authenticated') void sync()
      reset()
      return ok({ entry: result.data, crisis: processed.crisis })
    } finally {
      setSubmitting(false)
    }
  }, [draft, reset])

  return {
    draft,
    setMood,
    setBody,
    setThought,
    submit,
    canSave,
    submitting,
  }
}
