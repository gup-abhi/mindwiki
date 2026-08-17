import { handleRegister } from './auth/register'
import { handleChangePassword } from './auth/change-password'
import { handleLogin } from './auth/login'
import { handleLogout } from './auth/logout'
import { handleAccountDeletionReadiness, handleDeleteAccount } from './auth/delete-account'
import { handlePairStart, handlePairRedeem } from './auth/pair'
import { handleListDevices, handleRevokeDevice } from './auth/devices'
import { handleRecover } from './auth/recover'
import { handleRecoveryStatus, handleSetRecovery } from './auth/recovery-setup'
import { handleRefresh } from './auth/refresh'
import { handleSubscriptionStatus } from './auth/subscription'
import { handleUpload } from './storage/upload'
import { handleDelta } from './storage/delta'
import { handleSyncAudit } from './storage/audit'
import { authMiddleware } from './middleware/auth'
import { kvRateLimit, clientIp } from './middleware/rate-limit'
import { AuthCoordinator } from './auth/coordinator'
import type { Env } from './types'

const MINUTE = 60 * 1000
// Brute-force guards for the public auth surface. Login is the crown-jewel
// vector (password guess → escrow unwrap → plaintext journal), so it gets an
// email-scoped limit plus an IP-scoped one; recover/register are lower-volume.
const RATE_LIMITS = {
  loginEmail: { limit: 10, windowMs: 15 * MINUTE },
  loginIp: { limit: 30, windowMs: 15 * MINUTE },
  recoverEmail: { limit: 5, windowMs: 15 * MINUTE },
  registerIp: { limit: 5, windowMs: 15 * MINUTE },
}

function rateLimited(retryAfterSeconds?: number): Response {
  const seconds = retryAfterSeconds ?? 60
  return new Response(`Too many attempts. Retry in ${seconds}s`, {
    status: 429,
    headers: { 'Retry-After': String(seconds) },
  })
}

/** Email from a clone of the request body (handlers parse the original). */
async function bodyEmail(req: Request): Promise<string | null> {
  try {
    const body = (await req.clone().json()) as { email?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    return email || null
  } catch {
    return null
  }
}

export { AuthCoordinator }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const method = req.method
    const path = url.pathname

    // Public routes (no auth)
    if (method === 'POST' && path === '/auth/register') {
      const ip = clientIp(req)
      if (ip) {
        const rl = await kvRateLimit(env, 'register', ip, RATE_LIMITS.registerIp.limit, RATE_LIMITS.registerIp.windowMs)
        if (!rl.allowed) return rateLimited(rl.retryAfterSeconds)
      }
      return handleRegister(req, env)
    }
    if (method === 'POST' && path === '/auth/login') {
      const email = await bodyEmail(req)
      const ip = clientIp(req)
      if (email) {
        const rl = await kvRateLimit(env, 'login', email, RATE_LIMITS.loginEmail.limit, RATE_LIMITS.loginEmail.windowMs)
        if (!rl.allowed) return rateLimited(rl.retryAfterSeconds)
      }
      if (ip) {
        const rl = await kvRateLimit(env, 'login-ip', ip, RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.windowMs)
        if (!rl.allowed) return rateLimited(rl.retryAfterSeconds)
      }
      return handleLogin(req, env)
    }
    if (method === 'POST' && path === '/auth/recover') {
      const email = await bodyEmail(req)
      if (email) {
        const rl = await kvRateLimit(env, 'recover', email, RATE_LIMITS.recoverEmail.limit, RATE_LIMITS.recoverEmail.windowMs)
        if (!rl.allowed) return rateLimited(rl.retryAfterSeconds)
      }
      return handleRecover(req, env)
    }
    if (method === 'POST' && path === '/auth/pair/redeem') return handlePairRedeem(req, env)
    if (method === 'POST' && path === '/auth/refresh') return handleRefresh(req, env)

    // Protected routes (require a valid access token)
    const auth = await authMiddleware(req, env)
    if (!auth.ok) return new Response('Unauthorized', { status: 401 })
    const accountId = auth.accountId
    const familyId = auth.familyId
    if (auth.deleting) {
      if (method === 'DELETE' && path === '/auth/account') {
        return handleDeleteAccount(req, env, accountId, familyId)
      }
      return new Response('Account deletion in progress', { status: 409 })
    }

    if (method === 'POST' && path === '/auth/change-password')
      return handleChangePassword(req, env, accountId, familyId)
    if (method === 'GET' && path === '/auth/recovery') return handleRecoveryStatus(req, env, accountId)
    if (method === 'GET' && path === '/auth/subscription-status') return handleSubscriptionStatus(req, env, accountId)
    if (method === 'POST' && path === '/auth/recovery') return handleSetRecovery(req, env, accountId)
    if (method === 'POST' && path === '/auth/logout') return handleLogout(req, env, accountId, familyId)
    if (method === 'GET' && path === '/auth/account/deletion-readiness') {
      return handleAccountDeletionReadiness(env, accountId)
    }
    if (method === 'DELETE' && path === '/auth/account') return handleDeleteAccount(req, env, accountId, familyId)
    if (method === 'DELETE' && path.startsWith('/auth/devices/')) {
      let deviceId: string
      try {
        deviceId = decodeURIComponent(path.slice('/auth/devices/'.length))
      } catch {
        return new Response('Invalid device id', { status: 400 })
      }
      return handleRevokeDevice(req, env, accountId, familyId, deviceId)
    }
    if (method === 'POST' && path === '/auth/pair/start') return handlePairStart(req, env, accountId)
    if (method === 'GET' && path === '/auth/devices') return handleListDevices(req, env, accountId)
    if (method === 'GET' && path === `/sync/${encodeURIComponent(accountId)}/delta`) {
      return handleDelta(req, env, accountId, url)
    }
    if (method === 'GET' && path === `/sync/${encodeURIComponent(accountId)}/audit`) {
      return handleSyncAudit(env, accountId, url)
    }
    if (method === 'PUT' && path.startsWith(`/sync/${encodeURIComponent(accountId)}/v2/`)) {
      return handleUpload(req, env, accountId, path)
    }

    return new Response('Not Found', { status: 404 })
  },
}
