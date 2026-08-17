jest.mock('@tsndr/cloudflare-worker-jwt', () => ({
  verify: jest.fn(async () => true),
  sign: jest.fn(async () => 'header.' + Buffer.from(JSON.stringify({ sub: 'acc', fam: 'family-1', type: 'access' })).toString('base64url') + '.signature'),
}), { virtual: true })
jest.mock('bcryptjs', () => ({
  compare: jest.fn(async (value: string, hash: string) => {
    if (hash === '$2a$04$pROX6Ae0nF2RCLo46x2DF.r0mLTYSYDyAr04yXs8PbHCdW4ak0.Fe') return value === 'a'.repeat(64)
    return true
  }),
}), { virtual: true })

import { authMiddleware } from '../../server/src/middleware/auth'
import { hashDeletionToken } from '../../server/src/auth/deletion-marker'
import { handleRecover } from '../../server/src/auth/recover'
import type { Env } from '../../server/src/types'

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
  return { AUTH_KV: kv, JWT_SECRET: 'secret' } as unknown as Env
}

describe('server auth boundaries', () => {
  it('rejects revoked families and non-access JWTs', async () => {
    const kv = new FakeKV()
    await kv.put('family:fam', JSON.stringify({ account_id: 'acc', invalidated: true }))
    const access = `header.${Buffer.from(JSON.stringify({ sub: 'acc', fam: 'fam', exp: Math.floor(Date.now() / 1000) + 60, type: 'access' })).toString('base64url')}.signature`
    expect(await authMiddleware(new Request('https://example.test', { headers: { Authorization: `Bearer ${access}` } }), env(kv))).toEqual({ ok: false })

    const otherType = `header.${Buffer.from(JSON.stringify({ sub: 'acc', fam: 'fam', exp: Math.floor(Date.now() / 1000) + 60, type: 'refresh' })).toString('base64url')}.signature`
    expect(await authMiddleware(new Request('https://example.test', { headers: { Authorization: `Bearer ${otherType}` } }), env(kv))).toEqual({ ok: false })
  })

  it('rejects a family record belonging to another account', async () => {
    const kv = new FakeKV()
    await kv.put('family:fam', JSON.stringify({ account_id: 'other', invalidated: false }))
    const token = `header.${Buffer.from(JSON.stringify({ sub: 'acc', fam: 'fam', exp: Math.floor(Date.now() / 1000) + 60, type: 'access' })).toString('base64url')}.signature`
    expect(await authMiddleware(new Request('https://example.test', { headers: { Authorization: `Bearer ${token}` } }), env(kv))).toEqual({ ok: false })
  })

  it('allows only the initiating token to retry deletion after access expiry', async () => {
    const kv = new FakeKV()
    const expired = `header.${Buffer.from(JSON.stringify({ sub: 'acc', fam: 'fam', exp: 1, type: 'access' })).toString('base64url')}.signature`
    await kv.put('deleting:acc', JSON.stringify({
      account_id: 'acc',
      family_id: 'fam',
      token_hash: await hashDeletionToken(expired),
      status: 'pending',
      updated_at: Date.now(),
    }))
    expect(await authMiddleware(new Request('https://example.test', { headers: { Authorization: `Bearer ${expired}` } }), env(kv))).toEqual({
      ok: true,
      accountId: 'acc',
      familyId: 'fam',
      deleting: true,
    })

    const other = `header.${Buffer.from(JSON.stringify({ sub: 'acc', fam: 'other', exp: 1, type: 'access' })).toString('base64url')}.signature`
    expect(await authMiddleware(new Request('https://example.test', { headers: { Authorization: `Bearer ${other}` } }), env(kv))).toEqual({ ok: false })
  })

  it('records recovery session device metadata and family', async () => {
    const kv = new FakeKV()
    await kv.put('email:user@example.com', JSON.stringify({ account_id: 'acc' }))
    // Keep this fixture valid even if the bcrypt mock is unavailable in a CI worker.
    await kv.put('recovery:acc', JSON.stringify({
      recovery_bcrypt: '$2a$04$pROX6Ae0nF2RCLo46x2DF.r0mLTYSYDyAr04yXs8PbHCdW4ak0.Fe',
      encrypted_key: 'cipher',
    }))
    const response = await handleRecover(
      new Request('https://example.test/auth/recover', {
        method: 'POST',
        body: JSON.stringify({
          email: 'user@example.com',
          recovery_hash: 'a'.repeat(64),
          device_label: 'Recovery phone',
          platform: 'ios',
          device_id: 'device-1',
        }),
      }),
      env(kv)
    )
    expect(response.status).toBe(200)
    const body = await response.json() as { access_token: string; refresh_token: string; status: string }
    expect(body.access_token).toEqual(expect.any(String))
    expect(body.refresh_token).toEqual(expect.any(String))
    expect(body.status).toBe('active')
    expect(kv.json('devices:acc')).toEqual([
      expect.objectContaining({ id: 'device-1', label: 'Recovery phone', platform: 'ios', family_id: expect.any(String) }),
    ])
  })
})