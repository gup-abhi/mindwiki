import * as SecureStore from 'expo-secure-store'

// Tokens live ONLY in the OS keystore (iOS Keychain / Android Keystore) —
// never AsyncStorage, never SQLite (CLAUDE.md auth rules).
const ACCESS_KEY = 'mindwiki.access_token'
const REFRESH_KEY = 'mindwiki.refresh_token'
const ACCOUNT_KEY = 'mindwiki.account_id'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  accountId: string
}

export async function saveTokens(t: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, t.accessToken)
  await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken)
  await SecureStore.setItemAsync(ACCOUNT_KEY, t.accountId)
}

export async function getTokens(): Promise<AuthTokens | null> {
  const [accessToken, refreshToken, accountId] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
    SecureStore.getItemAsync(ACCOUNT_KEY),
  ])
  if (!accessToken || !refreshToken || !accountId) return null
  return { accessToken, refreshToken, accountId }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(ACCOUNT_KEY),
  ])
}
