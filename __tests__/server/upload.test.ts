import { handleUpload } from '../../server/src/storage/upload'
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
const path = '/sync/acc/entries/record-1'

function request(body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('sync upload boundary', () => {
  it('stores only a valid encrypted envelope', async () => {
    const r2 = new FakeR2()
    const response = await handleUpload(
      request({ ciphertext, updated_at: 10, record_id: 'record-1', table: 'entries' }),
      env(r2),
      'acc',
      path
    )

    expect(response.status).toBe(200)
    expect(r2.objects.get('acc/entries/record-1')).toEqual({
      body: JSON.stringify({ ciphertext, updated_at: 10 }),
      updated_at: '10',
    })
  })

  it.each([
    ['plaintext disguised as ciphertext', { ciphertext: '{"thought":"private"}', updated_at: 10, record_id: 'record-1', table: 'entries' }],
    ['short ciphertext', { ciphertext: 'abcd', updated_at: 10, record_id: 'record-1', table: 'entries' }],
    ['odd or non-hex ciphertext', { ciphertext: 'g'.repeat(56), updated_at: 10, record_id: 'record-1', table: 'entries' }],
    ['unknown table', { ciphertext, updated_at: 10, record_id: 'record-1', table: 'settings' }],
    ['path mismatch', { ciphertext, updated_at: 10, record_id: 'other', table: 'entries' }],
    ['invalid timestamp', { ciphertext, updated_at: -1, record_id: 'record-1', table: 'entries' }],
    ['extra field', { ciphertext, updated_at: 10, record_id: 'record-1', table: 'entries', thought: 'private' }],
  ])('rejects %s without storing it', async (_name, body) => {
    const r2 = new FakeR2()
    const response = await handleUpload(request(body), env(r2), 'acc', path)

    expect(response.status).toBe(400)
    expect(r2.objects.size).toBe(0)
  })

  it('acknowledges stale valid ciphertext without overwriting newer data', async () => {
    const r2 = new FakeR2()
    r2.objects.set('acc/entries/record-1', { body: 'newer', updated_at: '11' })

    const response = await handleUpload(
      request({ ciphertext, updated_at: 10, record_id: 'record-1', table: 'entries' }),
      env(r2),
      'acc',
      path
    )

    expect(response.status).toBe(200)
    expect(r2.objects.get('acc/entries/record-1')).toEqual({ body: 'newer', updated_at: '11' })
  })
})