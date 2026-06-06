import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Bumped whenever a sync pull applies remote records. Data hooks watch this and
// refetch, so a first-login pull (or any background sync) shows up immediately
// instead of only after the next app restart / screen refocus.
interface SyncState {
  revision: number
  bumpRevision: () => void
}

export const useSyncStore = create<SyncState>()(
  immer((set) => ({
    revision: 0,
    bumpRevision: () =>
      set((s) => {
        s.revision += 1
      }),
  }))
)
