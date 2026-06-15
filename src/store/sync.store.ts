import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Bumped whenever a sync pull applies remote records. Data hooks watch this and
// refetch, so a first-login pull (or any background sync) shows up immediately
// instead of only after the next app restart / screen refocus.
interface SyncState {
  revision: number
  bumpRevision: () => void
  // Bumped whenever a local record is enqueued for upload. useSync watches this
  // and runs a debounced background sync, so anything created/updated (including
  // background-generated wiki pages) uploads on its own without a manual sync.
  pendingSignal: number
  notifyLocalChange: () => void
}

export const useSyncStore = create<SyncState>()(
  immer((set) => ({
    revision: 0,
    bumpRevision: () =>
      set((s) => {
        s.revision += 1
      }),
    pendingSignal: 0,
    notifyLocalChange: () =>
      set((s) => {
        s.pendingSignal += 1
      }),
  }))
)
