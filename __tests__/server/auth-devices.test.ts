import { handleLogout } from '../../server/src/auth/logout'
import { handleRevokeDevice, revokeDevice, revokeFamily } from '../../server/src/auth/devices'
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
})