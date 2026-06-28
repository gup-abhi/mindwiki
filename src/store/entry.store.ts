import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Free-write draft: a mood + the body the user writes. `thought` is an optional
// CBT facet (the automatic thought) the user can choose to add; `emotion` is an
// optional feeling word the user may name (valence-matched to the mood). Anything
// not named here (distortion, people, places…) is derived from the text by the
// fast model after save — and the model fills `emotion` too only when unnamed.
export interface EntryDraft {
  mood: number | null
  body: string
  thought: string
  /** A feeling word the user picked, or null. Authoritative over the model's. */
  emotion: string | null
}

export interface EntryState {
  draft: EntryDraft
  setMood: (mood: number) => void
  setBody: (value: string) => void
  setThought: (value: string) => void
  setEmotion: (value: string | null) => void
  reset: () => void
}

const initialDraft = (): EntryDraft => ({ mood: null, body: '', thought: '', emotion: null })

export const useEntryStore = create<EntryState>()(
  immer((set) => ({
    draft: initialDraft(),
    setMood: (mood) =>
      set((s) => {
        // The feeling words are valence-matched to the mood, so changing the mood
        // clears a now-mismatched pick (re-tapping the same mood keeps it).
        if (mood !== s.draft.mood) s.draft.emotion = null
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
    setEmotion: (value) =>
      set((s) => {
        s.draft.emotion = value
      }),
    reset: () =>
      set((s) => {
        s.draft = initialDraft()
      }),
  }))
)
