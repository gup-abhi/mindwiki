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
  // True only for an account just created via register() this session — the one
  // signal that means "brand-new user". Login, recovery, device pairing, and a
  // returning session all leave it false, so onboarding never shows for them.
  // Session-only (not persisted); a restart hydrates as an existing session.
  isNewAccount: boolean
  setAuthenticated: (accountId: string, isNewAccount?: boolean) => void
  setUnauthenticated: () => void
}

export const useAuthStore = create<AuthState>()(
  immer((set) => ({
    status: 'loading',
    accountId: null,
    isNewAccount: false,
    setAuthenticated: (accountId, isNewAccount = false) =>
      set((s) => {
        s.status = 'authenticated'
        s.accountId = accountId
        s.isNewAccount = isNewAccount
      }),
    setUnauthenticated: () =>
      set((s) => {
        s.status = 'unauthenticated'
        s.accountId = null
        s.isNewAccount = false
      }),
  }))
)
