import { handleUpload } from '../../server/src/storage/upload'
import {
  MAX_CIPHERTEXT_HEX_LENGTH,
  MAX_FUTURE_SKEW_MS,
  MAX_UPLOAD_BODY_LENGTH,
  syncObjectKey,
} from '../../server/src/storage/protocol'
import type { Env } from '../../server/src/types'

class FakeR2 {
  readonly objects = new Map<string, { body: string; updated_at: string }>()

  async head(key: string): Promise<{ customMetadata: { updated_at: string } } | null> {
    const object = this.objects.get(key)
    return object ? { customMetadata: { updated_at: object.updated_at } } : null
  }

  async put(key: string, body: string, options: { customMetadata: { updated_at: string } }): Promise<void> {
    this.objects.set(key, { body, updated_at: options.customMetadata.updated_at })
  }
}

function env(r2: FakeR2): Env {
  return { R2: r2 } as unknown as Env
}

const ciphertext = 'a'.repeat(56)
const syncId = 'b'.repeat(64)
const path = `/sync/acc/v2/entries/${syncId}`

function envelope(over: Record<string, unknown> = {}) {
  return { version: 2, ciphertext, updated_at: 10, sync_id: syncId, table: 'entries', ...over }
}

function request(body: unknown, requestPath = path): Request {
  return new Request(`https://example.test${requestPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('sync V2 upload boundary', () => {
  it('stores only valid ciphertext under opaque object identity', async () => {
    const r2 = new FakeR2()
    const response = await handleUpload(request(envelope()), env(r2), 'acc', path)

    expect(response.status).toBe(200)
    expect(r2.objects.get(syncObjectKey('acc', 'entries', syncId))).toEqual({
      body: JSON.stringify({ ciphertext, updated_at: 10 }),
      updated_at: '10',
    })
    expect([...r2.objects.keys()][0]).not.toContain('record')
  })

  it.each([
    ['plaintext disguised as ciphertext', envelope({ ciphertext: '{"thought":"private"}' })],
    ['short ciphertext', envelope({ ciphertext: 'abcd' })],
    ['odd or non-hex ciphertext', envelope({ ciphertext: 'g'.repeat(56) })],
    ['unknown table', envelope({ table: 'settings' })],
    ['path sync-id mismatch', envelope({ sync_id: 'c'.repeat(64) })],
    ['invalid timestamp', envelope({ updated_at: -1 })],
    ['future timestamp', envelope({ updated_at: Date.now() + MAX_FUTURE_SKEW_MS + 60_000 })],
    ['extra field', envelope({ thought: 'private' })],
    ['legacy plaintext-id envelope', { ciphertext, updated_at: 10, record_id: 'private label', table: 'entries' }],
  ])('rejects %s without storing it', async (_name, body) => {
    const r2 = new FakeR2()
    const response = await handleUpload(request(body), env(r2), 'acc', path)
    expect(response.status).toBe(400)
    expect(r2.objects.size).toBe(0)
  })

  it('rejects foreign account and malformed paths', async () => {
    const r2 = new FakeR2()
    expect((await handleUpload(request(envelope(), path), env(r2), 'other', path)).status).toBe(400)
    expect((await handleUpload(request(envelope(), `/sync/acc/entries/${syncId}`), env(r2), 'acc', `/sync/acc/entries/${syncId}`)).status).toBe(400)
  })

  it('acknowledges stale valid ciphertext without overwriting newer data', async () => {
    const r2 = new FakeR2()
    r2.objects.set(syncObjectKey('acc', 'entries', syncId), { body: 'newer', updated_at: '11' })
    expect((await handleUpload(request(envelope()), env(r2), 'acc', path)).status).toBe(200)
    expect(r2.objects.get(syncObjectKey('acc', 'entries', syncId))).toEqual({ body: 'newer', updated_at: '11' })
  })

  it('does not overwrite malformed existing metadata', async () => {
    const r2 = new FakeR2()
    r2.objects.set(syncObjectKey('acc', 'entries', syncId), { body: 'audit-me', updated_at: 'invalid' })
    expect((await handleUpload(request(envelope()), env(r2), 'acc', path)).status).toBe(409)
    expect(r2.objects.get(syncObjectKey('acc', 'entries', syncId))?.body).toBe('audit-me')
  })

  it.each([
    ['wrong content type', 415],
    ['oversized request declaration', 413],
  ])('rejects %s before storing', async (name, status) => {
    const r2 = new FakeR2()
    const req = request(envelope())
    if (name === 'wrong content type') req.headers.set('Content-Type', 'text/plain')
    else req.headers.set('Content-Length', String(MAX_UPLOAD_BODY_LENGTH + 1))
    expect((await handleUpload(req, env(r2), 'acc', path)).status).toBe(status)
    expect(r2.objects.size).toBe(0)
  })

  it('rejects actual body bytes over protocol limit without trusting Content-Length', async () => {
    const r2 = new FakeR2()
    const req = request(envelope({ ciphertext: 'a'.repeat(MAX_UPLOAD_BODY_LENGTH + 2) }))
    req.headers.delete('Content-Length')
    expect((await handleUpload(req, env(r2), 'acc', path)).status).toBe(413)
    expect(r2.objects.size).toBe(0)
  })

  it('rejects ciphertext over protocol limit', async () => {
    const r2 = new FakeR2()
    expect((await handleUpload(
      request(envelope({ ciphertext: 'a'.repeat(MAX_CIPHERTEXT_HEX_LENGTH + 2) })),
      env(r2),
      'acc',
      path
    )).status).toBe(400)
  })
})