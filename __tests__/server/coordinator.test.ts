import { AuthCoordinator } from '../../server/src/auth/coordinator'

class FakeStorage {
  private readonly values = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }

  async transaction<T>(callback: (storage: FakeStorage) => Promise<T>): Promise<T> {
    return callback(this)
  }
}

function coordinator() {
  const storage = new FakeStorage()
  const instance = new AuthCoordinator({ storage } as never)
  return { instance, storage }
}

async function request(body: unknown): Promise<Request> {
  return new Request('https://coordinator.test', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('AuthCoordinator', () => {
  it('rejects malformed coordination requests without touching state', async () => {
    const { instance } = coordinator()

    const response = await instance.fetch(await request({
      operation: 'claim_refresh',
      account_id: '',
      family_id: 'family',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ status: 'invalid' })
  })

  it('allows the same account to retry an email reservation', async () => {
    const { instance } = coordinator()
    const body = { operation: 'reserve_email', account_id: 'account-a' }

    await expect((await instance.fetch(await request(body))).json()).resolves.toEqual({ status: 'reserved' })
    await expect((await instance.fetch(await request(body))).json()).resolves.toEqual({ status: 'reserved' })
  })

  it('does not allow another account to release a reservation', async () => {
    const { instance } = coordinator()

    await instance.fetch(await request({ operation: 'reserve_email', account_id: 'account-a' }))
    const response = await instance.fetch(await request({ operation: 'release_email', account_id: 'account-b' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'released' })
    const retry = await instance.fetch(await request({ operation: 'reserve_email', account_id: 'account-b' }))
    await expect(retry.json()).resolves.toEqual({ status: 'exists', account_id: 'account-a' })
  })

  it('claims a refresh token once and reports replay thereafter', async () => {
    const { instance } = coordinator()
    const body = { operation: 'claim_refresh', account_id: 'account-a', family_id: 'family-a' }

    await expect((await instance.fetch(await request(body))).json()).resolves.toEqual({ status: 'claimed' })
    await expect((await instance.fetch(await request(body))).json()).resolves.toEqual({
      status: 'replay',
      account_id: 'account-a',
      family_id: 'family-a',
    })
  })
})
