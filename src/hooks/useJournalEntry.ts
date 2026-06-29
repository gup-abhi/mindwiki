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
  const setAffect = useEntryStore((s) => s.setAffect)
  const setBody = useEntryStore((s) => s.setBody)
  const setThought = useEntryStore((s) => s.setThought)
  const setEmotion = useEntryStore((s) => s.setEmotion)
  const hydrate = useEntryStore((s) => s.hydrate)
  const reset = useEntryStore((s) => s.reset)

  const [submitting, setSubmitting] = useState(false)

  // A journal entry requires a grid point (mood + energy, one tap) and a named
  // feeling; the written body is optional and, when present, is what the AI
  // analyses. The feeling chips only surface once the grid is tapped, so this
  // gates in order.
  const canSave = draft.mood != null && draft.energy != null && draft.emotion != null

  const submit = useCallback(async (): Promise<Result<SubmitOutcome>> => {
    if (draft.mood == null) return err('ENTRY_INVALID', 'Choose how you’re feeling first')

    setSubmitting(true)
    try {
      const result = await createEntry({
        mood: draft.mood,
        situation: draft.body.trim(), // the free-write body is the entry text
        thought: draft.thought.trim(), // optional CBT facet ('' if not added)
        named_emotion: draft.emotion, // the feeling the user named (the model fills its own `emotion`)
        energy: draft.energy, // the grid's vertical axis
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
    setAffect,
    setBody,
    setThought,
    setEmotion,
    hydrate,
    reset,
    submit,
    canSave,
    submitting,
  }
}
