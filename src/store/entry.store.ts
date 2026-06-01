import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export const TOTAL_STEPS = 5

export type DraftField = 'situation' | 'thought' | 'behavior' | 'closing_note'

export interface EntryDraft {
  mood: number | null
  situation: string
  thought: string
  behavior: string
  closing_note: string
}

export interface EntryState {
  step: number
  draft: EntryDraft
  setMood: (mood: number) => void
  setField: (field: DraftField, value: string) => void
  goNext: () => void
  goBack: () => void
  goToStep: (step: number) => void
  reset: () => void
}

const initialDraft = (): EntryDraft => ({
  mood: null,
  situation: '',
  thought: '',
  behavior: '',
  closing_note: '',
})

export const useEntryStore = create<EntryState>()(
  immer((set) => ({
    step: 1,
    draft: initialDraft(),
    setMood: (mood) =>
      set((s) => {
        s.draft.mood = mood
      }),
    setField: (field, value) =>
      set((s) => {
        s.draft[field] = value
      }),
    goNext: () =>
      set((s) => {
        if (s.step < TOTAL_STEPS) s.step += 1
      }),
    goBack: () =>
      set((s) => {
        if (s.step > 1) s.step -= 1
      }),
    goToStep: (step) =>
      set((s) => {
        if (step >= 1 && step <= TOTAL_STEPS) s.step = step
      }),
    reset: () =>
      set((s) => {
        s.step = 1
        s.draft = initialDraft()
      }),
  }))
)
