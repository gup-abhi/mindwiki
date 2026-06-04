import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Auth is optional and only enables sync. 'anonymous' = never signed in (full
// journaling, no sync). 'authenticated' = signed in. 'unauthenticated' = was
// signed in but the session lapsed (re-login prompt) — journaling still works.
export type AuthStatus = 'anonymous' | 'authenticated' | 'unauthenticated'

export interface AuthState {
  status: AuthStatus
  accountId: string | null
  setAuthenticated: (accountId: string) => void
  setUnauthenticated: () => void
  setAnonymous: () => void
}

export const useAuthStore = create<AuthState>()(
  immer((set) => ({
    status: 'anonymous',
    accountId: null,
    setAuthenticated: (accountId) =>
      set((s) => {
        s.status = 'authenticated'
        s.accountId = accountId
      }),
    setUnauthenticated: () =>
      set((s) => {
        s.status = 'unauthenticated'
        s.accountId = null
      }),
    setAnonymous: () =>
      set((s) => {
        s.status = 'anonymous'
        s.accountId = null
      }),
  }))
)
