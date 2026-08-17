import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { type EntryDraft } from '@/types/entry'

// Free-write draft. Capture is an energy×pleasantness grid: `mood` is the
// pleasantness axis (1–5, unchanged semantics) and `energy` the arousal axis
// (1–5). `thought` is an optional CBT facet; `emotion` is the feeling word the
// user names (drawn from the grid quadrant). Anything not named here (distortion,
// people, places…) is derived from the text by the fast model after save.
export type { EntryDraft } from '@/types/entry'

export interface EntryState {
  draft: EntryDraft
  /** Set both grid axes at once (a single tap on the affect grid). */
  setAffect: (pleasantness: number, energy: number) => void
  setBody: (value: string) => void
  setThought: (value: string) => void
  setEmotion: (value: string | null) => void
  /** Replace the whole draft (restoring a saved draft). */
  hydrate: (draft: EntryDraft) => void
  reset: () => void
}

const initialDraft = (): EntryDraft => ({ mood: null, energy: null, body: '', thought: '', emotion: null })

export const useEntryStore = create<EntryState>()(
  immer((set) => ({
    draft: initialDraft(),
    setAffect: (pleasantness, energy) =>
      set((s) => {
        // The feeling words come from the grid quadrant, so moving to a new point
        // clears a now-mismatched pick (re-tapping the same cell keeps it).
        if (pleasantness !== s.draft.mood || energy !== s.draft.energy) s.draft.emotion = null
        s.draft.mood = pleasantness
        s.draft.energy = energy
      }),
    setBody: (value) =>
      set((s) => {
        s.draft.body = value
      }),
    setThought: (value) =>
      set((s) => {
        s.draft.thought = value
      }),
    setEmotion: (value) =>
      set((s) => {
        s.draft.emotion = value
      }),
    hydrate: (draft) =>
      set((s) => {
        s.draft = draft
      }),
    reset: () =>
      set((s) => {
        s.draft = initialDraft()
      }),
  }))
)
