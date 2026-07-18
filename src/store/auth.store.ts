import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Accounts are mandatory (no anonymous mode). 'loading' = launch hydration not
// yet resolved. 'authenticated' = signed in (master key + session present).
// 'unauthenticated' = the login screen is shown (session expired or logged out);
// the whole app is gated, so journaling is NOT accessible until re-login. Key +
// DB stay on disk after session *expiry* (same-account relogin restores without
// a re-pull); a *logout* wipes key + DB entirely. See docs/AUTH_DB_LIFECYCLE.md.
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
