import { handleRegister } from './auth/register'
import { handleChangePassword } from './auth/change-password'
import { handleLogin } from './auth/login'
import { handlePairStart, handlePairRedeem } from './auth/pair'
import { handleRecover } from './auth/recover'
import { handleRecoveryStatus, handleSetRecovery } from './auth/recovery-setup'
import { handleRefresh } from './auth/refresh'
import { handleUpload } from './storage/upload'
import { handleDelta } from './storage/delta'
import { authMiddleware } from './middleware/auth'
import type { Env } from './types'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const method = req.method
    const path = url.pathname

    // Public routes (no auth)
    if (method === 'POST' && path === '/auth/register') return handleRegister(req, env)
    if (method === 'POST' && path === '/auth/login') return handleLogin(req, env)
    if (method === 'POST' && path === '/auth/recover') return handleRecover(req, env)
    if (method === 'POST' && path === '/auth/pair/redeem') return handlePairRedeem(req, env)
    if (method === 'POST' && path === '/auth/refresh') return handleRefresh(req, env)

    // Protected routes (require a valid access token)
    const auth = await authMiddleware(req, env)
    if (!auth.ok) return new Response('Unauthorized', { status: 401 })
    const accountId = auth.accountId

    if (method === 'POST' && path === '/auth/change-password')
      return handleChangePassword(req, env, accountId)
    if (method === 'GET' && path === '/auth/recovery') return handleRecoveryStatus(req, env, accountId)
    if (method === 'POST' && path === '/auth/recovery') return handleSetRecovery(req, env, accountId)
    if (method === 'POST' && path === '/auth/pair/start') return handlePairStart(req, env, accountId)
    if (method === 'GET' && path.endsWith('/delta')) return handleDelta(req, env, accountId, url)
    if (method === 'PUT' && path.startsWith('/sync/')) return handleUpload(req, env, accountId, path)

    return new Response('Not Found', { status: 404 })
  },
}
