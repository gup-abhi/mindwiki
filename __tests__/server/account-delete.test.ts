jest.mock('@tsndr/cloudflare-worker-jwt', () => ({
  sign: jest.fn(async () => 'token'),
}), { virtual: true })
jest.mock('bcryptjs', () => ({
  compare: jest.fn(async () => true),
}), { virtual: true })

import { handleAccountDeletionReadiness, handleDeleteAccount } from '../../server/src/auth/delete-account'
import { handleLogin } from '../../server/src/auth/login'
import { handleRecover } from '../../server/src/auth/recover'
import { handleRefresh } from '../../server/src/auth/refresh'
import { sha256 } from '../../server/src/auth/tokens'
import { handlePairRedeem } from '../../server/src/auth/pair'
import type { Env } from '../../server/src/types'

class FakeKV {
  values = new Map<string, string>()
  failDelete = false

  async get<T = unknown>(key: string, type?: 'json'): Promise<T | null> {
    const value = this.values.get(key)
    if (value == null) return null
    return (type === 'json' ? JSON.parse(value) : value) as T
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error('kv unavailable')
    this.values.delete(key)
  }

  async list(options: { prefix?: string } = {}): Promise<{ keys: { name: string }[]; list_complete: boolean }> {
    const prefix = options.prefix ?? ''
    return {
      keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }
  }
}

class FakeR2 {
  keys = new Set<string>()
  failDelete = false
  failList = false

  async list(options: { prefix?: string }): Promise<{ objects: { key: string }[]; truncated: boolean }> {
    if (this.failList) throw new Error('r2 unavailable')
    return {
      objects: [...this.keys].filter((key) => key.startsWith(options.prefix ?? '')).map((key) => ({ key })),
      truncated: false,
    }
  }

  async delete(keys: string[]): Promise<void> {
    if (this.failDelete) throw new Error('r2 unavailable')
    keys.forEach((key) => this.keys.delete(key))
  }
}

function env(kv: FakeKV, r2: FakeR2): Env {
  return { AUTH_KV: kv, R2: r2, JWT_SECRET: 'secret' } as unknown as Env
}

describe('account deletion', () => {
  it('checks deletion readiness without mutating account or storage', async () => {
    const kv = new FakeKV()
    const r2 = new FakeR2()
    await kv.put('account:acc', JSON.stringify({ email: 'user@example.com' }))
    r2.keys.add('acc/v2/entries/' + 'a'.repeat(64))

    const response = await handleAccountDeletionReadiness(env(kv, r2), 'acc')

    expect(response.status).toBe(204)
    expect(kv.values.has('account:acc')).toBe(true)
    expect(r2.keys.size).toBe(1)
    expect(kv.values.has('deleting:acc')).toBe(false)
  })

  it('returns unavailable when remote storage cannot be reached', async () => {
    const kv = new FakeKV()
    const r2 = new FakeR2()
    r2.failList = true

    const response = await handleAccountDeletionReadiness(env(kv, r2), 'acc')

    expect(response.status).toBe(503)
    expect(kv.values.has('deleting:acc')).toBe(false)
  })

  it('deletes remote v2 and legacy objects plus account-owned metadata', async () => {
    const kv = new FakeKV()
    const r2 = new FakeR2()
    await kv.put('account:acc', JSON.stringify({ email: 'user@example.com' }))
    await kv.put('email:user@example.com', JSON.stringify({ account_id: 'acc' }))
    await kv.put('escrow:acc', '{}')
    await kv.put('recovery:acc', '{}')
    await kv.put('devices:acc', '[]')
    await kv.put('family:fam', JSON.stringify({ account_id: 'acc' }))
    await kv.put('refresh:token', JSON.stringify({ account_id: 'acc' }))
    await kv.put('pair:code', JSON.stringify({ account_id: 'acc' }))
    await kv.put('account:other', JSON.stringify({ email: 'other@example.com' }))
    await kv.put('family:other', JSON.stringify({ account_id: 'other' }))
    r2.keys = new Set(['acc/v2/entries/' + 'a'.repeat(64), 'acc/entries/legacy', 'other/v2/entries/' + 'b'.repeat(64)])

    const response = await handleDeleteAccount(new Request('https://example.test/auth/account'), env(kv, r2), 'acc', 'fam')

    expect(response.status).toBe(204)
    expect([...r2.keys]).toEqual(['other/v2/entries/' + 'b'.repeat(64)])
    expect(kv.values.has('account:acc')).toBe(false)
    expect(kv.values.has('email:user@example.com')).toBe(false)
    expect(kv.values.has('family:fam')).toBe(false)
    expect(kv.values.has('refresh:token')).toBe(false)
    expect(kv.values.has('pair:code')).toBe(false)
    expect(kv.values.has('account:other')).toBe(true)
    expect(kv.values.has('family:other')).toBe(true)
    expect(await kv.get('deleting:acc', 'json')).toEqual(expect.objectContaining({ status: 'complete', family_id: 'fam' }))
  })

  it('retains a pending marker and returns retryable failure when purge fails', async () => {
    const kv = new FakeKV()
    const r2 = new FakeR2()
    await kv.put('account:acc', JSON.stringify({ email: 'user@example.com' }))
    r2.keys.add('acc/v2/entries/' + 'a'.repeat(64))
    r2.failDelete = true

    const response = await handleDeleteAccount(new Request('https://example.test/auth/account'), env(kv, r2), 'acc', 'fam')

    expect(response.status).toBe(503)
    expect(await kv.get('deleting:acc', 'json')).toEqual(expect.objectContaining({ status: 'pending', family_id: 'fam' }))
    expect(kv.values.has('account:acc')).toBe(true)
  })

  it('blocks login, recovery, refresh, and pairing after deletion starts', async () => {
    const kv = new FakeKV()
    const r2 = new FakeR2()
    await kv.put('email:user@example.com', JSON.stringify({ account_id: 'acc' }))
    await kv.put('account:acc', JSON.stringify({ password_bcrypt: 'hash' }))
    await kv.put('recovery:acc', JSON.stringify({ recovery_bcrypt: 'hash', encrypted_key: 'cipher' }))
    await kv.put('refresh:token-hash', JSON.stringify({ account_id: 'acc', family_id: 'fam', expires_at: Date.now() + 60_000 }))
    await kv.put('pair:code', JSON.stringify({ account_id: 'acc' }))
    await kv.put('deleting:acc', JSON.stringify({ account_id: 'acc', family_id: 'fam', status: 'pending', updated_at: Date.now() }))
    const environment = env(kv, r2)

    expect((await handleLogin(new Request('https://example.test/auth/login', { method: 'POST', body: JSON.stringify({ email: 'user@example.com', password_hash: 'hash' }) }), environment)).status).toBe(401)
    expect((await handleRecover(new Request('https://example.test/auth/recover', { method: 'POST', body: JSON.stringify({ email: 'user@example.com', recovery_hash: 'hash' }) }), environment)).status).toBe(401)
    expect((await handlePairRedeem(new Request('https://example.test/auth/pair/redeem', { method: 'POST', body: JSON.stringify({ code: 'code' }) }), environment)).status).toBe(401)

    await kv.put(`refresh:${await sha256('token')}`, JSON.stringify({ account_id: 'acc', family_id: 'fam', expires_at: Date.now() + 60_000 }))
    expect((await handleRefresh(new Request('https://example.test/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: 'token' }) }), environment)).status).toBe(401)
  })

  it('returns idempotent success after completion', async () => {
    const kv = new FakeKV()
    const r2 = new FakeR2()
    await kv.put('deleting:acc', JSON.stringify({ account_id: 'acc', status: 'complete', family_id: 'fam', updated_at: Date.now() }))

    const response = await handleDeleteAccount(new Request('https://example.test/auth/account'), env(kv, r2), 'acc', 'fam')

    expect(response.status).toBe(204)
  })
})
