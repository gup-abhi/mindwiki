import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Re-lock when the app returns to the foreground after being backgrounded longer
// than this. Short enough to protect a set-down phone, long enough to tolerate a
// quick app switch (e.g. copying a 2FA code).
export const LOCK_GRACE_MS = 30_000

interface LockState {
  // Whether the lock overlay is currently shown.
  locked: boolean
  // Effective enabled = user preference AND the device can authenticate. The gate
  // sets this at launch / when the Settings toggle changes.
  enabled: boolean
  // Whether the cold-start lock decision has been made yet. Guards consumers (the
  // app-open cover) from acting during the brief pre-lock window where locked is
  // still its default false.
  resolved: boolean
  backgroundedAt: number | null
  setEnabled: (enabled: boolean) => void
  /** Lock now if enabled (used on cold start). */
  requireUnlock: () => void
  unlock: () => void
  onBackground: () => void
  /** Re-lock on foreground if enabled and the grace period elapsed. */
  onForeground: () => void
  /** Clear transient lock state on session end; keeps the `enabled` preference. */
  resetTransient: () => void
}

export const useLockStore = create<LockState>()(
  immer((set) => ({
    locked: false,
    enabled: true,
    resolved: false,
    backgroundedAt: null,
    setEnabled: (enabled) =>
      set((s) => {
        s.enabled = enabled
        s.resolved = true
        if (!enabled) s.locked = false
      }),
    requireUnlock: () =>
      set((s) => {
        if (s.enabled) s.locked = true
      }),
    unlock: () =>
      set((s) => {
        s.locked = false
        s.backgroundedAt = null
      }),
    onBackground: () =>
      set((s) => {
        s.backgroundedAt = Date.now()
      }),
    onForeground: () =>
      set((s) => {
        if (s.enabled && s.backgroundedAt !== null && Date.now() - s.backgroundedAt > LOCK_GRACE_MS) {
          s.locked = true
        }
        s.backgroundedAt = null
      }),
    resetTransient: () =>
      set((s) => {
        s.locked = false
        s.backgroundedAt = null
      }),
  }))
)
