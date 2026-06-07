# MindWiki — Server Architecture

Cloudflare Workers. V8 isolates — **not Node.js**. No `fs`, no `path`, no `process.env` (use `env.VAR_NAME`). Zero cold start. Deploy globally in seconds.

The server is a **dumb encrypted blob store with thin auth**. It stores ciphertext and issues JWTs. It never reads user content.

---

## Wrangler config

```toml
# server/wrangler.toml

name = "mindwiki-server"
main = "src/index.ts"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[env.production]
name = "mindwiki-server-prod"
kv_namespaces = [
  { binding = "AUTH_KV", id = "YOUR_KV_NAMESPACE_ID" }
]
r2_buckets = [
  { binding = "R2", bucket_name = "mindwiki-sync" }
]

[env.staging]
name = "mindwiki-server-staging"
kv_namespaces = [
  { binding = "AUTH_KV", id = "YOUR_STAGING_KV_NAMESPACE_ID" }
]
r2_buckets = [
  { binding = "R2", bucket_name = "mindwiki-sync-staging" }
]
```

```toml
# server/wrangler.dev.toml (local dev — uses Miniflare, no real KV/R2)
[miniflare]
kv_persist = ".miniflare/kv"
r2_persist = ".miniflare/r2"
```

```bash
# Create resources
wrangler kv:namespace create AUTH_KV
wrangler kv:namespace create AUTH_KV --preview

wrangler r2 bucket create mindwiki-sync
wrangler r2 bucket create mindwiki-sync-staging

# Secrets (never in wrangler.toml)
wrangler secret put JWT_SECRET              # 256-bit random hex
wrangler secret put APNS_KEY               # APNs private key (.p8 content)
wrangler secret put APNS_KEY_ID
wrangler secret put APNS_TEAM_ID
wrangler secret put FCM_SERVICE_ACCOUNT    # FCM v1 service account JSON
```

---

## KV schema

All KV keys are prefixed to avoid collisions.

```
account:{account_id}
  → { email: string | null, password_bcrypt: string, created_at: number }

escrow:{account_id}
  → { encrypted_key: string, salt: string, updated_at: number }
  Note: encrypted_key is AES-GCM(master_key, argon2(password, salt))
        Server cannot decrypt without user's password.

recovery:{account_id}
  → { recovery_bcrypt: string, encrypted_key: string, updated_at: number }
  Second escrow path for /auth/recover when the password is lost.
  encrypted_key is AES-GCM(master_key, HKDF(bip39_entropy)); recovery_bcrypt
  is bcrypt(SHA-256(recovery phrase)). Server cannot decrypt without the phrase.

pair:{code}
  → { account_id: string }  (expirationTtl 300s, one-time — deleted on redeem)
  Device pairing. /auth/pair/start (auth) mints it; /auth/pair/redeem (public)
  swaps it for a session. The master key is NOT here — it travels device→device
  inside the QR, so a stolen code mints only a session, never decryption.

refresh:{token_hash}
  → { account_id: string, family_id: string, expires_at: number }
  token_hash = SHA-256(refresh_token) — never store the token itself

family:{family_id}
  → { account_id: string, invalidated: boolean }
  Invalidated if refresh token reuse detected (anti-replay)

push:{account_id}
  → { tokens: Array<{ token: string, platform: 'ios' | 'android' }> }

email:{email_lower}
  → { account_id: string }
  Lookup index: email → account_id
```

---

## TypeScript router

```typescript
// server/src/index.ts

import { handleRegister } from './auth/register'
import { handleLogin } from './auth/login'
import { handleRecover } from './auth/recover'
import { handleRecoveryStatus, handleSetRecovery } from './auth/recovery-setup'
import { handlePairStart, handlePairRedeem } from './auth/pair'
import { handleRefresh } from './auth/refresh'
import { handleLogout } from './auth/logout'
import { handleChangePassword } from './auth/change-password'
import { handleDeleteAccount } from './auth/delete-account'
import { handleUpload } from './storage/upload'
import { handleDelta } from './storage/delta'
import { handleStorageDelete } from './storage/delete'
import { handleRegisterPush } from './push/register'
import { authMiddleware } from './middleware/auth'

export interface Env {
  AUTH_KV: KVNamespace
  R2: R2Bucket
  JWT_SECRET: string
  APNS_KEY: string
  APNS_KEY_ID: string
  APNS_TEAM_ID: string
  FCM_SERVICE_ACCOUNT: string
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const method = req.method
    const path = url.pathname

    // Public routes (no auth)
    if (method === 'POST' && path === '/auth/register') return handleRegister(req, env)
    if (method === 'POST' && path === '/auth/login')    return handleLogin(req, env)
    if (method === 'POST' && path === '/auth/recover')  return handleRecover(req, env)
    if (method === 'POST' && path === '/auth/pair/redeem') return handlePairRedeem(req, env)
    if (method === 'POST' && path === '/auth/refresh')  return handleRefresh(req, env)

    // Protected routes (require valid JWT)
    const auth = await authMiddleware(req, env)
    if (!auth.ok) return new Response('Unauthorized', { status: 401 })
    const accountId = auth.accountId

    if (method === 'POST'   && path === '/auth/logout')           return handleLogout(req, env, accountId)
    if (method === 'POST'   && path === '/auth/change-password')  return handleChangePassword(req, env, accountId)
    if (method === 'GET'    && path === '/auth/recovery')         return handleRecoveryStatus(req, env, accountId)
    if (method === 'POST'   && path === '/auth/recovery')         return handleSetRecovery(req, env, accountId)
    if (method === 'POST'   && path === '/auth/pair/start')       return handlePairStart(req, env, accountId)
    if (method === 'DELETE' && path === '/auth/account')          return handleDeleteAccount(req, env, accountId)
    if (method === 'PUT'    && path.startsWith('/sync/'))         return handleUpload(req, env, accountId, path)
    if (method === 'GET'    && path.endsWith('/delta'))           return handleDelta(req, env, accountId, url)
    if (method === 'DELETE' && path.startsWith('/sync/'))         return handleStorageDelete(req, env, accountId)
    if (method === 'POST'   && path === '/push/register')         return handleRegisterPush(req, env, accountId)

    return new Response('Not Found', { status: 404 })
  }
}
```

---

## Auth middleware

```typescript
// server/src/middleware/auth.ts

import { verify } from '@tsndr/cloudflare-worker-jwt'

type AuthResult =
  | { ok: true; accountId: string }
  | { ok: false }

export async function authMiddleware(req: Request, env: Env): Promise<AuthResult> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { ok: false }

  try {
    const valid = await verify(token, env.JWT_SECRET)
    if (!valid) return { ok: false }

    const payload = JSON.parse(atob(token.split('.')[1]))
    if (!payload.sub || payload.exp < Date.now() / 1000) return { ok: false }

    return { ok: true, accountId: payload.sub }
  } catch {
    return { ok: false }
  }
}
```

---

## Auth endpoints

### POST /auth/register

```typescript
// server/src/auth/register.ts

import { hash } from 'bcryptjs'
import { sign } from '@tsndr/cloudflare-worker-jwt'

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{
    email?: string
    password_hash: string          // SHA-256(password), hex — client side
    key_escrow: { encrypted_key: string; salt: string }
  }>()

  // Validate
  if (!body.password_hash || body.password_hash.length !== 64) {
    return new Response('Invalid password_hash', { status: 400 })
  }

  // Check email uniqueness if provided
  if (body.email) {
    const existing = await env.AUTH_KV.get(`email:${body.email.toLowerCase()}`)
    if (existing) return new Response('Email already registered', { status: 409 })
  }

  // bcrypt the client-provided SHA-256 hash
  const passwordBcrypt = await hash(body.password_hash, 12)

  const accountId = crypto.randomUUID()
  const now = Date.now()

  // Store account
  await env.AUTH_KV.put(`account:${accountId}`, JSON.stringify({
    email: body.email ?? null,
    password_bcrypt: passwordBcrypt,
    created_at: now,
  }))

  // Store email lookup index
  if (body.email) {
    await env.AUTH_KV.put(`email:${body.email.toLowerCase()}`, JSON.stringify({ account_id: accountId }))
  }

  // Store key escrow
  await env.AUTH_KV.put(`escrow:${accountId}`, JSON.stringify({
    encrypted_key: body.key_escrow.encrypted_key,
    salt: body.key_escrow.salt,
    updated_at: now,
  }))

  const { accessToken, refreshToken } = await issueTokens(accountId, env)

  return Response.json({ account_id: accountId, access_token: accessToken, refresh_token: refreshToken })
}
```

### POST /auth/login

```typescript
// server/src/auth/login.ts

import { compare } from 'bcryptjs'

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const { email, password_hash } = await req.json<{ email: string; password_hash: string }>()

  const emailRecord = await env.AUTH_KV.get(`email:${email.toLowerCase()}`, 'json') as { account_id: string } | null
  if (!emailRecord) return new Response('Invalid credentials', { status: 401 })

  const account = await env.AUTH_KV.get(`account:${emailRecord.account_id}`, 'json') as { password_bcrypt: string } | null
  if (!account) return new Response('Invalid credentials', { status: 401 })

  const valid = await compare(password_hash, account.password_bcrypt)
  if (!valid) return new Response('Invalid credentials', { status: 401 })

  const escrow = await env.AUTH_KV.get(`escrow:${emailRecord.account_id}`, 'json')
  const { accessToken, refreshToken } = await issueTokens(emailRecord.account_id, env)

  return Response.json({
    account_id: emailRecord.account_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    key_escrow: escrow,  // client uses this to re-derive master key
  })
}
```

### POST /auth/refresh (with family invalidation)

```typescript
// server/src/auth/refresh.ts

export async function handleRefresh(req: Request, env: Env): Promise<Response> {
  const { refresh_token } = await req.json<{ refresh_token: string }>()

  const tokenHash = await sha256(refresh_token)
  const stored = await env.AUTH_KV.get(`refresh:${tokenHash}`, 'json') as {
    account_id: string; family_id: string; expires_at: number
  } | null

  if (!stored) {
    // Token not found — may be reuse of invalidated token
    // Check if this is a known family and invalidate if so
    return new Response('Invalid refresh token', { status: 401 })
  }

  if (stored.expires_at < Date.now()) {
    await env.AUTH_KV.delete(`refresh:${tokenHash}`)
    return new Response('Refresh token expired', { status: 401 })
  }

  // Check family not invalidated
  const family = await env.AUTH_KV.get(`family:${stored.family_id}`, 'json') as { invalidated: boolean } | null
  if (family?.invalidated) {
    return new Response('Session invalidated', { status: 401 })
  }

  // Invalidate old token
  await env.AUTH_KV.delete(`refresh:${tokenHash}`)

  // Issue new token pair (same family)
  const { accessToken, refreshToken: newRefreshToken } = await issueTokens(
    stored.account_id, env, stored.family_id
  )

  return Response.json({ access_token: accessToken, refresh_token: newRefreshToken })
}
```

---

## Storage endpoints

```typescript
// server/src/storage/upload.ts

export async function handleUpload(
  req: Request, env: Env, accountId: string, path: string
): Promise<Response> {
  // path: /sync/{accountId}/{table}/{recordId}
  const parts = path.split('/')
  if (parts[2] !== accountId) return new Response('Forbidden', { status: 403 })

  const body = await req.json<{ ciphertext: string; updated_at: number; record_id: string; table: string }>()

  // Store ciphertext — server cannot read this
  await env.R2.put(
    `${accountId}/${body.table}/${body.record_id}`,
    JSON.stringify({ ciphertext: body.ciphertext, updated_at: body.updated_at }),
    { customMetadata: { updated_at: String(body.updated_at) } }
  )

  return new Response('OK', { status: 200 })
}
```

```typescript
// server/src/storage/delta.ts

export async function handleDelta(
  req: Request, env: Env, accountId: string, url: URL
): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? 0)

  const listed = await env.R2.list({ prefix: `${accountId}/` })

  const changed = listed.objects.filter(obj => {
    const updatedAt = Number(obj.customMetadata?.updated_at ?? 0)
    return updatedAt > since
  })

  const results = await Promise.all(
    changed.map(async obj => {
      const body = await env.R2.get(obj.key)
      if (!body) return null
      return body.json()   // returns { ciphertext, updated_at }
    })
  )

  return Response.json(results.filter(Boolean))
}
```

---

## Token issuance helper

```typescript
// server/src/auth/tokens.ts

import { sign } from '@tsndr/cloudflare-worker-jwt'

export async function issueTokens(
  accountId: string,
  env: Env,
  existingFamilyId?: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const familyId = existingFamilyId ?? crypto.randomUUID()

  // Access token: 15-minute JWT
  const accessToken = await sign(
    { sub: accountId, exp: Math.floor(Date.now() / 1000) + 900, type: 'access' },
    env.JWT_SECRET
  )

  // Refresh token: opaque random string, hashed for storage
  const refreshToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  const tokenHash = await sha256(refreshToken)
  await env.AUTH_KV.put(
    `refresh:${tokenHash}`,
    JSON.stringify({
      account_id: accountId,
      family_id: familyId,
      expires_at: Date.now() + 90 * 24 * 60 * 60 * 1000,  // 90 days
    }),
    { expirationTtl: 90 * 24 * 60 * 60 }
  )

  // Ensure family record exists
  if (!existingFamilyId) {
    await env.AUTH_KV.put(`family:${familyId}`, JSON.stringify({ account_id: accountId, invalidated: false }))
  }

  return { accessToken, refreshToken }
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}
```

---

## Local dev

```bash
cd server
npm install
wrangler dev   # Miniflare on port 8787

# Test auth flow
curl -X POST http://localhost:8787/auth/register \
  -H "Content-Type: application/json" \
  -d '{"password_hash":"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3","key_escrow":{"encrypted_key":"test","salt":"test"}}'
```

---

## Deployment

```bash
# Staging
wrangler deploy --env staging

# Production
wrangler deploy --env production

# Check logs
wrangler tail --env production
```

GitHub Actions (`.github/workflows/deploy-server.yml`):
```yaml
on:
  push:
    branches: [main]
    paths: ['server/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          workingDirectory: server
          command: deploy --env production
```
