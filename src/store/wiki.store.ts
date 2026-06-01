import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Tracks how many background wiki syntheses are in flight, so the UI can show a
// "synthesizing…" indicator. Driven by the pipeline (begin/end around the
// fire-and-forget wiki update).
export interface WikiStatusState {
  pending: number
  begin: () => void
  end: () => void
}

export const useWikiStore = create<WikiStatusState>()(
  immer((set) => ({
    pending: 0,
    begin: () =>
      set((s) => {
        s.pending += 1
      }),
    end: () =>
      set((s) => {
        s.pending = Math.max(0, s.pending - 1)
      }),
  }))
)
