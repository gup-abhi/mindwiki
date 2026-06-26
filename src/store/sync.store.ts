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
  // True while a sync pass is actively running (push+pull).
  syncing: boolean
  setSyncing: (v: boolean) => void
  // True from a fresh login/pair until that device's first pull completes, so the
  // UI can reassure the user their data is being restored (not lost) on a new
  // device. Set by login/pair; cleared by the engine on the first successful sync.
  restoring: boolean
  beginRestore: () => void
  endRestore: () => void
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
    syncing: false,
    setSyncing: (v) =>
      set((s) => {
        s.syncing = v
      }),
    restoring: false,
    beginRestore: () =>
      set((s) => {
        s.restoring = true
      }),
    endRestore: () =>
      set((s) => {
        s.restoring = false
      }),
  }))
)
