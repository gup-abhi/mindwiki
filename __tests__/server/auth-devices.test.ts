jest.mock('@tsndr/cloudflare-worker-jwt', () => ({
  verify: jest.fn(async () => true),
  sign: jest.fn(async () => 'header.' + Buffer.from(JSON.stringify({ sub: 'acc', fam: 'family-other', type: 'access' })).toString('base64url') + '.signature'),
}), { virtual: true })

import { authMiddleware } from '../../server/src/middleware/auth'
import { handleLogout } from '../../server/src/auth/logout'
import { handleRefresh } from '../../server/src/auth/refresh'
import { handleRevokeDevice, revokeDevice, revokeFamily } from '../../server/src/auth/devices'
import { sha256 } from '../../server/src/auth/tokens'
import type { Env } from '../../server/src/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const worker = require('../../server/src/index').default as { fetch(req: Request, env: Env): Promise<Response> }

class FakeKV {
  private values = new Map<string, string>()

  async get<T = unknown>(key: string, type?: 'json'): Promise<T | null> {
    const value = this.values.get(key)
    if (value == null) return null
    return (type === 'json' ? JSON.parse(value) : value) as T
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }

  json(key: string): unknown {
    const value = this.values.get(key)
    return value == null ? null : JSON.parse(value)
  }
}

function env(kv: FakeKV): Env {
  return { AUTH_KV: kv } as unknown as Env
}

const devices = [
  { id: 'current', label: 'Phone', platform: 'ios', paired_at: 1, family_id: 'fam-current' },
  { id: 'other', label: 'Laptop', platform: 'web', paired_at: 2, family_id: 'fam-other' },
]

async function setup() {
  const kv = new FakeKV()
  await kv.put('devices:acc', JSON.stringify(devices))
  await kv.put('family:fam-current', JSON.stringify({ account_id: 'acc', invalidated: false }))
  await kv.put('family:fam-other', JSON.stringify({ account_id: 'acc', invalidated: false }))
  return kv
}

describe('server device session boundaries', () => {
  it('self logout ignores body target and revokes caller family', async () => {
    const kv = await setup()
    const response = await handleLogout(
      new Request('https://example.test/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ device_id: 'other' }),
      }),
      env(kv),
      'acc',
      'fam-current'
    )

    expect(response.status).toBe(204)
    expect(kv.json('family:fam-current')).toMatchObject({ invalidated: true })
    expect(kv.json('family:fam-other')).toMatchObject({ invalidated: false })
    expect(kv.json('devices:acc')).toEqual([devices[1]])
  })

  it('remote revoke invalidates other family and preserves caller', async () => {
    const kv = await setup()
    expect(await revokeDevice(env(kv), 'acc', 'other', 'fam-current')).toBe('revoked')
    expect(kv.json('family:fam-other')).toMatchObject({ invalidated: true })
    expect(kv.json('devices:acc')).toEqual([devices[0]])
  })

  it('rejects current family and missing device without mutation', async () => {
    const kv = await setup()
    expect(await revokeDevice(env(kv), 'acc', 'current', 'fam-current')).toBe('current')
    expect(await revokeDevice(env(kv), 'acc', 'missing', 'fam-current')).toBe('missing')
    expect(kv.json('devices:acc')).toEqual(devices)
    expect(kv.json('family:fam-current')).toMatchObject({ invalidated: false })
  })

  it('remote handler returns bounded 409/404 responses', async () => {
    const kv = await setup()
    const current = await handleRevokeDevice(new Request('https://example.test'), env(kv), 'acc', 'fam-current', 'current')
    const missing = await handleRevokeDevice(new Request('https://example.test'), env(kv), 'acc', 'fam-current', 'missing')
    expect(current.status).toBe(409)
    expect(missing.status).toBe(404)
  })

  it('self family revoke removes only matching device rows', async () => {
    const kv = await setup()
    await revokeFamily(env(kv), 'acc', 'fam-current')
    expect(kv.json('devices:acc')).toEqual([devices[1]])
    expect(kv.json('family:fam-other')).toMatchObject({ invalidated: false })
  })

  it('logout invalidates current access and refresh tokens without affecting another family', async () => {
    const kv = await setup()
    const currentRefresh = 'current-refresh'
    const otherRefresh = 'other-refresh'
    await kv.put(`refresh:${await sha256(currentRefresh)}`, JSON.stringify({
      account_id: 'acc',
      family_id: 'fam-current',
      expires_at: Date.now() + 60_000,
    }))
    await kv.put(`refresh:${await sha256(otherRefresh)}`, JSON.stringify({
      account_id: 'acc',
      family_id: 'fam-other',
      expires_at: Date.now() + 60_000,
    }))

    const response = await handleLogout(
      new Request('https://example.test/auth/logout', { method: 'POST' }),
      env(kv),
      'acc',
      'fam-current'
    )

    expect(response.status).toBe(204)
    expect(await handleRefresh(
      new Request('https://example.test/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: currentRefresh }),
      }),
      env(kv)
    )).toMatchObject({ status: 401 })
    expect(await handleRefresh(
      new Request('https://example.test/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: otherRefresh }),
      }),
      env(kv)
    )).toMatchObject({ status: 200 })

    const access = `header.${Buffer.from(JSON.stringify({
      sub: 'acc',
      fam: 'fam-current',
      exp: Math.floor(Date.now() / 1000) + 60,
      type: 'access',
    })).toString('base64url')}.signature`
    expect(await authMiddleware(
      new Request('https://example.test/auth/logout', { headers: { Authorization: `Bearer ${access}` } }),
      env(kv)
    )).toEqual({ ok: false })
  })

  it('rejects logout without authentication at the router boundary', async () => {
    const kv = await setup()
    const response = await worker.fetch(
      new Request('https://example.test/auth/logout', { method: 'POST' }),
      env(kv)
    )
    expect(response.status).toBe(401)
  })

  it('rejects malformed authorization without throwing', async () => {
    const kv = await setup()
    expect(await authMiddleware(
      new Request('https://example.test', { headers: { Authorization: 'Bearer malformed' } }),
      env(kv)
    )).toEqual({ ok: false })
  })
})
