// Sync server base URL. Defaults to local Miniflare (wrangler dev). Override
// per build with EXPO_PUBLIC_API_URL (e.g. a deployed Cloudflare Worker).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'
