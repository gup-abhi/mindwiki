jest.mock('@tsndr/cloudflare-worker-jwt', () => ({
  sign: jest.fn(async () => 'token'),
  verify: jest.fn(async () => true),
}), { virtual: true })
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => 'hash'),
  compare: jest.fn(async () => true),
}), { virtual: true })

jest.mock('../../server/src/middleware/auth', () => ({
  authMiddleware: jest.fn(async () => ({ ok: true, accountId: 'acc', familyId: 'fam' })),
}))

import { authMiddleware } from '../../server/src/middleware/auth'
import type { Env } from '../../server/src/types'

// require keeps root app tsc from traversing every Worker auth module; Worker
// package has its own strict typecheck below.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const worker = require('../../server/src/index').default as { fetch(req: Request, env: unknown): Promise<Response> }

const mockAuth = authMiddleware as jest.Mock

class FakeR2 {
  async list() { return { objects: [], truncated: false } }
}

const env = { R2: new FakeR2() } as unknown as Env

describe('Worker sync routes', () => {
  beforeEach(() => mockAuth.mockResolvedValue({ ok: true, accountId: 'acc', familyId: 'fam' }))

  it('accepts exact authenticated-account delta route', async () => {
    const response = await worker.fetch(new Request('https://example.test/sync/acc/delta?since=0'), env)
    expect(response.status).toBe(200)
  })

  it.each([
    '/other/delta',
    '/sync/other/delta',
    '/sync/acc/extra/delta',
    '/sync/acc/delta/extra',
  ])('rejects ambiguous or foreign delta route %s', async (path) => {
    const response = await worker.fetch(new Request(`https://example.test${path}?since=0`), env)
    expect(response.status).toBe(404)
  })

  it('exposes authenticated account deletion readiness without starting deletion', async () => {
    const response = await worker.fetch(new Request('https://example.test/auth/account/deletion-readiness'), env)
    expect(response.status).toBe(204)
  })

  it('exposes only authenticated count-only audit dry run', async () => {
    expect((await worker.fetch(new Request('https://example.test/sync/acc/audit'), env)).status).toBe(400)
    expect((await worker.fetch(new Request('https://example.test/sync/acc/audit?dry_run=true'), env)).status).toBe(200)
    expect((await worker.fetch(new Request('https://example.test/sync/other/audit?dry_run=true'), env)).status).toBe(404)
  })

  it('rejects unauthenticated sync requests', async () => {
    mockAuth.mockResolvedValueOnce({ ok: false })
    const response = await worker.fetch(new Request('https://example.test/sync/acc/delta?since=0'), env)
    expect(response.status).toBe(401)
  })

  it('rejects legacy and malformed upload routes', async () => {
    const init = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    expect((await worker.fetch(new Request('https://example.test/sync/acc/entries/id', init), env)).status).toBe(404)
    expect((await worker.fetch(new Request('https://example.test/sync/other/v2/entries/' + 'a'.repeat(64), init), env)).status).toBe(404)
  })
})