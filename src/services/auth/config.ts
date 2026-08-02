// Sync server base URL. Local Miniflare is development-only; release builds
// must receive an HTTPS Worker URL through EXPO_PUBLIC_API_URL.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'
if (!__DEV__ && !configuredApiUrl.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_API_URL must use HTTPS in release builds')
}
export const API_URL = configuredApiUrl
