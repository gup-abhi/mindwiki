import { useCallback, useEffect, useState } from 'react'

import {
  register,
  loginNewDevice,
  addRecoveryPhrase,
  preparePendingRecovery,
  getPendingRecoveryPhrase,
  recoverAccount,
  changePassword,
  logout as logoutAccount,
  deleteAccount as deleteAccountService,
} from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'
import { clearRecoveryPending, setRecoveryPending } from '@/services/auth/recovery-pending-marker'

export type AuthMode = 'register' | 'login'

/**
 * Drives the register/login/recover forms. Register and recovery are two-step
 * wizards — the auth service stores the session but does NOT flip auth state, so
 * the user can't skip past saving their recovery phrase / setting a new password.
 * This hook owns that final 'authenticate' step. Never throws.
 */
export function useAuth() {
  const recoveryPending = useAuthStore((s) => s.status === 'recovery_pending')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set after a successful register: the phrase to show once before entering the app.
  const [pendingPhrase, setPendingPhrase] = useState<{ accountId: string; phrase: string } | null>(null)
  const [pendingRecoveryError, setPendingRecoveryError] = useState<string | null>(null)
  const [pendingRetry, setPendingRetry] = useState(0)

  useEffect(() => {
    if (!recoveryPending || pendingPhrase) return
    const accountId = useAuthStore.getState().accountId
    const phrase = getPendingRecoveryPhrase()
    if (accountId && phrase) {
      setPendingPhrase({ accountId, phrase })
      return
    }
    let active = true
    setPendingRecoveryError(null)
    void preparePendingRecovery().then((result) => {
      if (!active) return
      if (result.success && accountId) {
        setPendingPhrase({ accountId, phrase: result.data.recoveryPhrase })
        void setRecoveryPending({ accountId, phase: 'showing_phrase' })
      } else if (!result.success) setPendingRecoveryError(result.error.message)
    })
    return () => { active = false }
  }, [pendingPhrase, recoveryPending, pendingRetry])

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
        void setRecoveryPending({ accountId: res.data.accountId, phase: 'showing_phrase' })
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
  const retryPendingRecovery = useCallback(() => {
    setPendingRetry((value) => value + 1)
  }, [])

  const confirmPhrase = useCallback(async (): Promise<boolean> => {
    if (!pendingPhrase) return false
    setSubmitting(true)
    setError(null)
    const activated = await addRecoveryPhrase(pendingPhrase.phrase)
    setSubmitting(false)
    if (!activated.success) {
      setError(activated.error.message)
      return false
    }
    await clearRecoveryPending()
    setPendingPhrase(null)
    useAuthStore.getState().setAuthenticated(pendingPhrase.accountId, true)
    return true
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

  return {
    submit,
    submitting,
    error: error ?? pendingRecoveryError,
    pendingPhrase,
    recoveryPending,
    confirmPhrase,
    retryPendingRecovery,
    recover,
    logout,
    deleteAccount,
  }
}
