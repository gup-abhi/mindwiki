import { useCallback, useState } from 'react'

import { register, loginNewDevice } from '@/services/auth/auth.service'

export type AuthMode = 'register' | 'login'

/**
 * Drives the register/login form: tracks submit progress + the last error and
 * delegates to the auth service. On success the service sets the auth store to
 * 'authenticated', which flips the launch gate to the app — so callers only need
 * the boolean. Never throws.
 */
export function useAuth() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (mode: AuthMode, email: string, password: string): Promise<boolean> => {
      setSubmitting(true)
      setError(null)
      const res =
        mode === 'register'
          ? await register(password, email.trim() || undefined)
          : await loginNewDevice(email.trim(), password)
      setSubmitting(false)
      if (!res.success) setError(res.error.message)
      return res.success
    },
    []
  )

  return { submit, submitting, error }
}
