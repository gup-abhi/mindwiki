import { useCallback, useMemo, useState } from 'react'

import { type CrisisAssessment } from '@/services/crisis/detector'
import { onEntrySaved } from '@/services/notifications/scheduler'
import { processEntry } from '@/services/pipeline'
import { createEntry, type Entry } from '@/services/storage/entries'
import { sync } from '@/services/sync/engine'
import { useAuthStore } from '@/store/auth.store'
import { useEntryStore, TOTAL_STEPS } from '@/store/entry.store'
import { type Result, ok, err } from '@/types/result'

export interface SubmitOutcome {
  entry: Entry
  crisis: CrisisAssessment
}

/**
 * Drives the CBT 5-step entry flow: exposes the draft + step, validates required
 * steps (1 mood, 2 situation, 3 thought), allows skipping optional steps (4, 5),
 * and submits to the storage layer. A failed submit never throws — returns Result.
 */
export function useJournalEntry() {
  const step = useEntryStore((s) => s.step)
  const draft = useEntryStore((s) => s.draft)
  const setMood = useEntryStore((s) => s.setMood)
  const setField = useEntryStore((s) => s.setField)
  const goNext = useEntryStore((s) => s.goNext)
  const goBack = useEntryStore((s) => s.goBack)
  const reset = useEntryStore((s) => s.reset)

  const [submitting, setSubmitting] = useState(false)

  const canAdvance = useMemo(() => {
    switch (step) {
      case 1:
        return draft.mood != null
      case 2:
        return draft.situation.trim().length > 0
      case 3:
        return draft.thought.trim().length > 0
      default:
        return true // steps 4 (behavior) & 5 (closing_note) are optional
    }
  }, [step, draft])

  const isLastStep = step === TOTAL_STEPS

  const next = useCallback(() => {
    if (canAdvance) goNext()
  }, [canAdvance, goNext])

  const skip = useCallback(() => {
    goNext()
  }, [goNext])

  const submit = useCallback(async (): Promise<Result<SubmitOutcome>> => {
    if (draft.mood == null) {
      return err('ENTRY_INVALID', 'Mood is required before submitting')
    }
    setSubmitting(true)
    try {
      const result = await createEntry({
        mood: draft.mood,
        situation: draft.situation,
        thought: draft.thought,
        behavior: draft.behavior.trim() || null,
        closing_note: draft.closing_note.trim() || null,
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
    step,
    totalSteps: TOTAL_STEPS,
    draft,
    setMood,
    setField,
    next,
    back: goBack,
    skip,
    submit,
    canAdvance,
    isLastStep,
    submitting,
  }
}
