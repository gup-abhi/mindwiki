import { runtimeStoreBridge } from '@/services/runtime/store-bridge'
import { invalidateSessionWork } from './session-work'
import { type Result, ok, err } from '@/types/result'

import { API_URL } from './config'
import * as tokenStore from './token-store'
import { type AuthTokens, type TokenSnapshot } from './token-store'

export type RefreshOutcome =
  | { kind: 'refreshed'; tokens: AuthTokens }
  | { kind: 'transient' }
  | { kind: 'rejected' }
  | { kind: 'stale' }

let refreshFlight: { refreshToken: string; promise: Promise<RefreshOutcome> } | null = null

function sameSession(a: AuthTokens, b: AuthTokens | null): boolean {
  return !!b && a.refreshToken === b.refreshToken && a.accountId === b.accountId
}

async function snapshot(): Promise<TokenSnapshot | null> {
  const store = tokenStore as typeof tokenStore & {
    getTokenSnapshot?: () => Promise<TokenSnapshot | null>
  }
  if (store.getTokenSnapshot) return store.getTokenSnapshot()
  const tokens = await tokenStore.getTokens()
  return tokens ? { ...tokens, generation: 0 } : null
}

async function clearMatching(tokens: AuthTokens, generation: number): Promise<boolean> {
  const store = tokenStore as typeof tokenStore & {
    clearTokensIfCurrent?: (expected: AuthTokens, expectedGeneration?: number) => Promise<boolean>
  }
  if (store.clearTokensIfCurrent) return store.clearTokensIfCurrent(tokens, generation)
  const current = await tokenStore.getTokens()
  if (!sameSession(tokens, current) || current?.accessToken !== tokens.accessToken) return false
  await tokenStore.clearTokens()
  return true
}

async function refreshFor(snapshotAt401: TokenSnapshot, signal?: AbortSignal): Promise<RefreshOutcome> {
  if (refreshFlight?.refreshToken === snapshotAt401.refreshToken) return refreshFlight.promise

  // Register flight before first await. Otherwise concurrent callers can all
  // pass the current-session read before any one publishes its promise.
  const promise = (async (): Promise<RefreshOutcome> => {
    const current = await snapshot()
    if (!current || !sameSession(snapshotAt401, current)) return { kind: 'stale' }
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: snapshotAt401.refreshToken }),
        signal,
      })
      if (res.status === 401) return { kind: 'rejected' }
      if (!res.ok) return { kind: 'transient' }
      const data = (await res.json()) as { access_token?: string; refresh_token?: string }
      if (!data.access_token || !data.refresh_token) return { kind: 'transient' }
      const next = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accountId: snapshotAt401.accountId,
      }
      const store = tokenStore as typeof tokenStore & {
        saveTokensIfCurrent?: (expected: AuthTokens, next: AuthTokens, expectedGeneration?: number) => Promise<boolean>
      }
      const committed = store.saveTokensIfCurrent
        ? await store.saveTokensIfCurrent(snapshotAt401, next, snapshotAt401.generation)
        : sameSession(snapshotAt401, await tokenStore.getTokens())
      if (!committed) return { kind: 'stale' }
      if (!store.saveTokensIfCurrent) await tokenStore.saveTokens(next)
      return { kind: 'refreshed', tokens: next }
    } catch {
      return { kind: 'transient' }
    }
  })()

  refreshFlight = { refreshToken: snapshotAt401.refreshToken, promise }
  void promise.finally(() => {
    if (refreshFlight?.promise === promise) refreshFlight = null
  })
  return promise
}

/**
 * Refresh using one coordinator per rotating refresh token. Boolean API remains
 * for callers outside authenticatedFetch; transport and server rejection both
 * map to false there.
 */
export async function refreshAccessToken(): Promise<boolean> {
  const current = await snapshot()
  if (!current) return false
  const result = await refreshFor(current)
  return result.kind === 'refreshed'
}

/**
 * Protected fetch. One shared refresh handles a 401 burst. Transport failure
 * preserves session; only definitive rejection of the still-current session gates
 * the app. Each request retries at most once.
 */
export async function authenticatedFetch(
  path: string,
  init: RequestInit = {}
): Promise<Result<Response>> {
  const initial = await snapshot()
  if (!initial) return err('NOT_AUTHENTICATED', 'No active session')

  const send = (accessToken: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${accessToken}` },
    })

  let res: Response
  try {
    res = await send(initial.accessToken)
  } catch (e) {
    return err('NETWORK_ERROR', 'Request failed', e)
  }
  if (res.status !== 401) return ok(res)

  const outcome = await refreshFor(initial, init.signal ?? undefined)
  if (outcome.kind === 'transient') return err('NETWORK_ERROR', 'Session refresh unavailable')
  if (outcome.kind === 'stale') return err('STALE_SESSION', 'Session changed while request was in flight')
  if (outcome.kind === 'rejected') {
    const cleared = await clearMatching(initial, initial.generation)
    if (cleared) {
      invalidateSessionWork()
      runtimeStoreBridge().setUnauthenticated()
    }
    return err('SESSION_EXPIRED', 'Session expired — please sign in again')
  }

  // CAS commit already proved refresh belongs to this session. Use committed
  // tuple directly; token-store serialization prevents stale writes after wipe.
  const current = outcome.tokens
  if (current.accountId !== initial.accountId) return err('STALE_SESSION', 'Session changed while request was in flight')
  const currentGeneration = tokenStore.getTokenGeneration?.() ?? initial.generation
  try {
    res = await send(current.accessToken)
  } catch (e) {
    return err('NETWORK_ERROR', 'Request failed', e)
  }
  if (res.status === 401) {
    const cleared = await clearMatching(current, currentGeneration)
    if (cleared) {
      invalidateSessionWork()
      runtimeStoreBridge().setUnauthenticated()
    }
    return err('SESSION_EXPIRED', 'Session expired — please sign in again')
  }
  return ok(res)
}