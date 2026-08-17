import { handleSubscriptionStatus } from '../../server/src/auth/subscription'
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
}

function env(kv: FakeKV): Env {
  return { AUTH_KV: kv, JWT_SECRET: 'secret' } as unknown as Env
}

describe('subscription status', () => {
  it('returns the stable account trial anchor without content fields', async () => {
    const kv = new FakeKV()
    await kv.put('account:acc', JSON.stringify({
      email: 'user@example.com',
      password_bcrypt: 'hash',
      created_at: 100,
      trial_started_at: 200,
    }))

    const response = await handleSubscriptionStatus(new Request('https://example.test'), env(kv), 'acc')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ trial_started_at: 200 })
  })

  it('uses immutable account creation time for legacy accounts', async () => {
    const kv = new FakeKV()
    await kv.put('account:acc', JSON.stringify({ created_at: 100 }))

    const response = await handleSubscriptionStatus(new Request('https://example.test'), env(kv), 'acc')

    expect(await response.json()).toEqual({ trial_started_at: 100 })
  })

  it('does not invent a trial anchor for an unavailable account', async () => {
    const response = await handleSubscriptionStatus(
      new Request('https://example.test'),
      env(new FakeKV()),
      'missing'
    )

    expect(response.status).toBe(404)
  })
})
