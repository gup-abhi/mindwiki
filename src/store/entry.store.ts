import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Free-write draft: a mood + the body the user writes. `thought` is an optional
// CBT facet (the automatic thought) the user can choose to add; everything else
// (emotion, distortion, people, places…) is derived from the text by the
// fast model after save — no forced fields.
export interface EntryDraft {
  mood: number | null
  body: string
  thought: string
}

export interface EntryState {
  draft: EntryDraft
  setMood: (mood: number) => void
  setBody: (value: string) => void
  setThought: (value: string) => void
  reset: () => void
}

const initialDraft = (): EntryDraft => ({ mood: null, body: '', thought: '' })

export const useEntryStore = create<EntryState>()(
  immer((set) => ({
    draft: initialDraft(),
    setMood: (mood) =>
      set((s) => {
        s.draft.mood = mood
      }),
    setBody: (value) =>
      set((s) => {
        s.draft.body = value
      }),
    setThought: (value) =>
      set((s) => {
        s.draft.thought = value
      }),
    reset: () =>
      set((s) => {
        s.draft = initialDraft()
      }),
  }))
)
