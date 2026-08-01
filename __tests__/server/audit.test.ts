import { handleSyncAudit } from '../../server/src/storage/audit'
import { syncObjectKey } from '../../server/src/storage/protocol'
import type { Env } from '../../server/src/types'

class FakeR2 {
  readonly objects = new Map<string, { body: string; updatedAt: string }>()
  async list() {
    return {
      objects: [...this.objects].map(([key, value]) => ({
        key,
        size: value.body.length,
        customMetadata: { updated_at: value.updatedAt },
      })),
      truncated: false,
    }
  }
  async get(key: string) {
    const value = this.objects.get(key)
    return value ? { json: async () => JSON.parse(value.body) } : null
  }
}

const ciphertext = 'a'.repeat(56)

describe('sync object audit dry run', () => {
  it('requires dry-run mode and returns counts without identifiers or content', async () => {
    const r2 = new FakeR2()
    const privateId = 'private belief / family 日本語'
    r2.objects.set(syncObjectKey('acc', 'entries', 'b'.repeat(64)), {
      body: JSON.stringify({ ciphertext, updated_at: 10 }), updatedAt: '10',
    })
    r2.objects.set(`acc/entry_entities/${privateId}`, { body: '{', updatedAt: '11' })
    const env = { R2: r2 } as unknown as Env

    expect((await handleSyncAudit(env, 'acc', new URL('https://example.test/sync/acc/audit'))).status).toBe(400)
    const response = await handleSyncAudit(
      env,
      'acc',
      new URL('https://example.test/sync/acc/audit?dry_run=true')
    )
    const text = await response.text()
    const body = JSON.parse(text) as { scanned: number; valid: number; invalid: { envelope: number } }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ scanned: 2, valid: 1, invalid: { envelope: 1 } })
    expect(text).not.toContain(privateId)
    expect(text).not.toContain(ciphertext)
  })
})