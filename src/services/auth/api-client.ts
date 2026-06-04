import { useAuthStore } from '@/store/auth.store'
import { type Result, ok, err } from '@/types/result'

import { API_URL } from './config'
import { getTokens, saveTokens, clearTokens } from './token-store'

/**
 * Exchange the stored refresh token for a fresh access+refresh pair. Returns
 * false (and leaves cleanup to the caller) on any failure.
 */
export async function refreshAccessToken(): Promise<boolean> {
  const tokens = await getTokens()
  if (!tokens) return false
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { access_token: string; refresh_token: string }
    await saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accountId: tokens.accountId,
    })
    return true
  } catch {
    return false
  }
}

/**
 * fetch() against the sync server with the access token attached. On a 401 it
 * transparently refreshes once and retries; if refresh fails the session is
 * cleared and auth state set to 'unauthenticated' (journaling keeps working).
 */
export async function authenticatedFetch(
  path: string,
  init: RequestInit = {}
): Promise<Result<Response>> {
  const tokens = await getTokens()
  if (!tokens) return err('NOT_AUTHENTICATED', 'No active session')

  const send = (accessToken: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${accessToken}` },
    })

  try {
    let res = await send(tokens.accessToken)
    if (res.status === 401) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        await clearTokens()
        useAuthStore.getState().setUnauthenticated()
        return err('SESSION_EXPIRED', 'Session expired — please sign in again')
      }
      const fresh = await getTokens()
      res = await send(fresh!.accessToken)
    }
    return ok(res)
  } catch (e) {
    return err('NETWORK_ERROR', 'Request failed', e)
  }
}
