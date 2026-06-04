import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Accounts are mandatory (no anonymous mode). 'loading' = launch hydration not
// yet resolved. 'authenticated' = signed in (master key + session present).
// 'unauthenticated' = needs login; cached local journaling still works offline,
// only sync pauses until re-login.
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthState {
  status: AuthStatus
  accountId: string | null
  setAuthenticated: (accountId: string) => void
  setUnauthenticated: () => void
}

export const useAuthStore = create<AuthState>()(
  immer((set) => ({
    status: 'loading',
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
  }))
)
