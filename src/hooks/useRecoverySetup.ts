import { useCallback, useEffect, useState } from 'react'

import { getRecoveryStatus, addRecoveryPhrase } from '@/services/auth/auth.service'
import { useAuthStore } from '@/store/auth.store'

/**
 * Backfills a recovery phrase for accounts created before recovery existed.
 * Checks (best-effort) whether the logged-in account has one; if not, exposes a
 * setup action that generates + uploads the escrow and returns the phrase to show
 * once. Silent on any failure — never blocks journaling.
 */
export function useRecoverySetup() {
  const status = useAuthStore((s) => s.status)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') {
      setNeedsSetup(false)
      return
    }
    let cancelled = false
    void getRecoveryStatus().then((res) => {
      if (!cancelled && res.success) setNeedsSetup(!res.data)
    })
    return () => {
      cancelled = true
    }
  }, [status])

  const setup = useCallback(async () => {
    setBusy(true)
    setError(null)
    const res = await addRecoveryPhrase()
    setBusy(false)
    if (!res.success) {
      setError('Couldn’t set up recovery. Check your connection and try again.')
      return
    }
    setPhrase(res.data.recoveryPhrase)
  }, [])

  /** Dismiss the one-time phrase view; the account now has recovery, so hide the card. */
  const done = useCallback(() => {
    setPhrase(null)
    setNeedsSetup(false)
  }, [])

  return { needsSetup, phrase, busy, error, setup, done }
}
