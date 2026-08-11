import { useCallback, useState } from 'react'

import {
  register,
  loginNewDevice,
  recoverAccount,
  changePassword,
  logout as logoutAccount,
  deleteAccount as deleteAccountService,
} from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'

export type AuthMode = 'register' | 'login'

/**
 * Drives the register/login/recover forms. Register and recovery are two-step
 * wizards — the auth service stores the session but does NOT flip auth state, so
 * the user can't skip past saving their recovery phrase / setting a new password.
 * This hook owns that final 'authenticate' step. Never throws.
 */
export function useAuth() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set after a successful register: the phrase to show once before entering the app.
  const [pendingPhrase, setPendingPhrase] = useState<{ accountId: string; phrase: string } | null>(null)

  const submit = useCallback(
    async (mode: AuthMode, email: string, password: string): Promise<boolean> => {
      setSubmitting(true)
      setError(null)
      if (mode === 'register') {
        const res = await register(email.trim(), password)
        setSubmitting(false)
        if (!res.success) {
          setError(res.error.message)
          return false
        }
        setPendingPhrase({ accountId: res.data.accountId, phrase: res.data.recoveryPhrase })
        return true
      }
      const res = await loginNewDevice(email.trim(), password)
      setSubmitting(false)
      if (!res.success) setError(res.error.message)
      return res.success // loginNewDevice authenticates on success
    },
    []
  )

  /** Enter the app after the user confirms they've saved their recovery phrase. */
  const confirmPhrase = useCallback(() => {
    // isNewAccount=true: this is the only path that just registered a fresh
    // account, so it's the only one that starts the guided writing flow.
    if (pendingPhrase) useAuthStore.getState().setAuthenticated(pendingPhrase.accountId, true)
  }, [pendingPhrase])

  /** Recover with the phrase, set a new password, then enter the app. */
  const recover = useCallback(
    async (email: string, phrase: string, newPassword: string): Promise<boolean> => {
      setSubmitting(true)
      setError(null)
      const rec = await recoverAccount(email.trim(), phrase)
      if (!rec.success) {
        setSubmitting(false)
        setError(rec.error.message)
        return false
      }
      const changed = await changePassword(newPassword)
      setSubmitting(false)
      if (!changed.success) {
        setError('Recovered, but setting the new password failed. Please try again.')
        return false
      }
      useAuthStore.getState().setAuthenticated(rec.data.accountId)
      return true
    },
    []
  )

  /** Sign out: destructive local logout; DB, master key, and tokens are wiped. */
  const logout = useCallback(() => logoutAccount(), [])

  const deleteAccount = useCallback(async (): Promise<boolean> => {
    setSubmitting(true)
    setError(null)
    const result = await deleteAccountService()
    if (useAuthStore.getState().status === 'authenticated') {
      setSubmitting(false)
      if (!result.success) setError(result.error.message)
    }
    return result.success
  }, [])

  return { submit, submitting, error, pendingPhrase, confirmPhrase, recover, logout, deleteAccount }
}
