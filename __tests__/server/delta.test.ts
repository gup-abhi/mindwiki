import { handleDelta } from '../../server/src/storage/delta'
import { DELTA_PAGE_SIZE, syncObjectKey } from '../../server/src/storage/protocol'
import type { Env } from '../../server/src/types'

interface StoredObject { body: string; updatedAt: string }

class FakeR2 {
  readonly objects = new Map<string, StoredObject>()

  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix ?? '')).sort()
    const offset = options.cursor ? Number(options.cursor) : 0
    const limit = options.limit ?? 1000
    const page = keys.slice(offset, offset + limit)
    const next = offset + page.length
    return {
      objects: page.map((key) => ({
        key,
        size: this.objects.get(key)?.body.length ?? 0,
        customMetadata: { updated_at: this.objects.get(key)?.updatedAt ?? '0' },
      })),
      truncated: next < keys.length,
      cursor: next < keys.length ? String(next) : undefined,
    }
  }

  async get(key: string) {
    const object = this.objects.get(key)
    if (!object) return null
    return { json: async () => JSON.parse(object.body) }
  }
}

function env(r2: FakeR2): Env { return { R2: r2 } as unknown as Env }
function request(cursor?: string): { req: Request; url: URL } {
  const url = new URL('https://example.test/sync/acc/delta?since=0')
  if (cursor) url.searchParams.set('cursor', cursor)
  return { req: new Request(url), url }
}
const ciphertext = 'a'.repeat(56)
const syncId = 'b'.repeat(64)

describe('sync delta boundary', () => {
  it('returns valid V2 and legacy envelopes while skipping malformed objects', async () => {
    const r2 = new FakeR2()
    r2.objects.set(syncObjectKey('acc', 'entries', syncId), {
      body: JSON.stringify({ ciphertext, updated_at: 10 }), updatedAt: '10',
    })
    const legacyId = 'entry:belief:work / family % 日本語'
    r2.objects.set(`acc/entry_entities/${legacyId}`, {
      body: JSON.stringify({ ciphertext, updated_at: 11 }), updatedAt: '11',
    })
    r2.objects.set(`acc/entries/bad-json`, { body: '{', updatedAt: '12' })
    r2.objects.set(`acc/entries/plaintext`, {
      body: JSON.stringify({ ciphertext: '{"thought":"private"}', updated_at: 13 }), updatedAt: '13',
    })
    r2.objects.set(`acc/entries/extra`, {
      body: JSON.stringify({ ciphertext, updated_at: 14, extra: 'private' }), updatedAt: '14',
    })
    r2.objects.set(`acc/entries/mismatch`, {
      body: JSON.stringify({ ciphertext, updated_at: 16 }), updatedAt: '15',
    })

    const { req, url } = request()
    const response = await handleDelta(req, env(r2), 'acc', url)
    const body = await response.json() as { records: unknown[]; next_cursor: string | null }

    expect(response.status).toBe(200)
    expect(body.records).toEqual(expect.arrayContaining([
      { version: 2, table: 'entries', sync_id: syncId, ciphertext, updated_at: 10 },
      { version: 1, table: 'entry_entities', record_id: legacyId, ciphertext, updated_at: 11 },
    ]))
    expect(body.records).toHaveLength(2)
    expect(body.next_cursor).toBeNull()
  })

  it('paginates with an opaque cursor and bounded list size', async () => {
    const r2 = new FakeR2()
    for (let i = 0; i < DELTA_PAGE_SIZE + 2; i++) {
      const id = i.toString(16).padStart(64, '0')
      r2.objects.set(syncObjectKey('acc', 'entries', id), {
        body: JSON.stringify({ ciphertext, updated_at: i + 1 }), updatedAt: String(i + 1),
      })
    }

    const first = request()
    const firstBody = await (await handleDelta(first.req, env(r2), 'acc', first.url)).json() as {
      records: unknown[]; next_cursor: string | null
    }
    expect(firstBody.records).toHaveLength(DELTA_PAGE_SIZE)
    expect(firstBody.next_cursor).toEqual(expect.any(String))

    const second = request(firstBody.next_cursor ?? undefined)
    const secondBody = await (await handleDelta(second.req, env(r2), 'acc', second.url)).json() as {
      records: unknown[]; next_cursor: string | null
    }
    expect(secondBody.records).toHaveLength(2)
    expect(secondBody.next_cursor).toBeNull()
  })

  it('rejects invalid cursors and timestamps', async () => {
    const r2 = new FakeR2()
    const badCursor = request('not-base64!')
    expect((await handleDelta(badCursor.req, env(r2), 'acc', badCursor.url)).status).toBe(400)
    const url = new URL('https://example.test/sync/acc/delta?since=-1')
    expect((await handleDelta(new Request(url), env(r2), 'acc', url)).status).toBe(400)
  })
})