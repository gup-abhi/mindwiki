import * as SecureStore from 'expo-secure-store'

// Tokens live ONLY in the OS keystore (iOS Keychain / Android Keystore) —
// never AsyncStorage, never SQLite (CLAUDE.md auth rules).
const SESSION_KEY = 'mindwiki.auth_session'
const ACCESS_KEY = 'mindwiki.access_token'
const REFRESH_KEY = 'mindwiki.refresh_token'
const ACCOUNT_KEY = 'mindwiki.account_id'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  accountId: string
}

export interface TokenSnapshot extends AuthTokens {
  generation: number
}

let mutationQueue: Promise<void> = Promise.resolve()
let generation = 0

function serialize(t: AuthTokens): string {
  return JSON.stringify(t)
}

function parse(raw: string | null): AuthTokens | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<AuthTokens>
    if (
      typeof candidate.accessToken !== 'string' ||
      typeof candidate.refreshToken !== 'string' ||
      typeof candidate.accountId !== 'string' ||
      !candidate.accessToken ||
      !candidate.refreshToken ||
      !candidate.accountId
    ) return null
    return {
      accessToken: candidate.accessToken,
      refreshToken: candidate.refreshToken,
      accountId: candidate.accountId,
    }
  } catch {
    return null
  }
}

async function readRaw(): Promise<AuthTokens | null> {
  const current = parse(await SecureStore.getItemAsync(SESSION_KEY))
  if (current) return current

  // One-release migration from the old three-item tuple. Never accept a partial
  // tuple: partial credentials are unusable and must not be resurrected.
  const [accessToken, refreshToken, accountId] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
    SecureStore.getItemAsync(ACCOUNT_KEY),
  ])
  if (!accessToken || !refreshToken || !accountId) {
    if (accessToken || refreshToken || accountId) {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
        SecureStore.deleteItemAsync(ACCOUNT_KEY),
      ])
    }
    return null
  }

  const migrated = { accessToken, refreshToken, accountId }
  await SecureStore.setItemAsync(SESSION_KEY, serialize(migrated))
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(ACCOUNT_KEY),
  ])
  return migrated
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(operation, operation)
  mutationQueue = run.then(() => undefined, () => undefined)
  return run
}

export async function saveTokens(t: AuthTokens): Promise<void> {
  await enqueue(async () => {
    await SecureStore.setItemAsync(SESSION_KEY, serialize(t))
    // Remove legacy tuple after successful single-item write.
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(ACCOUNT_KEY),
    ])
    generation++
  })
}

export async function saveTokensIfCurrent(
  expected: AuthTokens,
  next: AuthTokens,
  expectedGeneration?: number
): Promise<boolean> {
  return enqueue(async () => {
    const current = await readRaw()
    if (
      !current ||
      current.accessToken !== expected.accessToken ||
      current.refreshToken !== expected.refreshToken ||
      current.accountId !== expected.accountId ||
      (expectedGeneration !== undefined && generation !== expectedGeneration)
    ) return false
    await SecureStore.setItemAsync(SESSION_KEY, serialize(next))
    generation++
    return true
  })
}

export async function getTokens(): Promise<AuthTokens | null> {
  return readRaw()
}

export async function getTokenSnapshot(): Promise<TokenSnapshot | null> {
  const tokens = await getTokens()
  return tokens ? { ...tokens, generation } : null
}

export function getTokenGeneration(): number {
  return generation
}

/** Invalidate queued refresh/login writes without deleting the persisted tuple. */
export function invalidateTokenMutations(): void {
  generation++
}

export async function clearTokens(): Promise<void> {
  await enqueue(async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY)
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(ACCOUNT_KEY),
    ])
    generation++
  })
}

export async function clearTokensIfCurrent(
  expected: AuthTokens,
  expectedGeneration?: number
): Promise<boolean> {
  return enqueue(async () => {
    const current = await readRaw()
    if (
      !current ||
      current.accessToken !== expected.accessToken ||
      current.refreshToken !== expected.refreshToken ||
      current.accountId !== expected.accountId ||
      (expectedGeneration !== undefined && generation !== expectedGeneration)
    ) return false
    await SecureStore.deleteItemAsync(SESSION_KEY)
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(ACCOUNT_KEY),
    ])
    generation++
    return true
  })
}