import { type SqliteDatabase } from '@/services/storage/db'
import { type Result, ok, err } from '@/types/result'

// Import the real implementation — T-02A.2 exercises backfill failure isolation
// against an in-memory fake, not a mock of the function under test.
import { backfillEntityEmbeddings, upsertEntityEmbedding } from '@/services/storage/entity-embeddings'

// Minimal in-memory backing for the three SQL statements backfill issues:
//   SELECT DISTINCT label FROM entry_entities WHERE type = ?
//   SELECT label, content_hash FROM entity_embeddings WHERE type = ?
//   INSERT INTO entity_embeddings (...) VALUES (...) ON CONFLICT(...) DO UPDATE ...
let entityRows: { type: string; label: string }[] = []
let embeddingRows: { type: string; label: string; content_hash: string }[] = []
let fakeDb: SqliteDatabase

beforeEach(() => {
  entityRows = []
  embeddingRows = []
  fakeDb = {
    async execute(sql: string, params: unknown[] = []) {
      const s = String(sql).trim()
      if (/^SELECT DISTINCT label FROM entry_entities/i.test(s)) {
        const type = String(params[0])
        const seen = new Set<string>()
        const labels: string[] = []
        for (const r of entityRows) {
          if (r.type !== type || seen.has(r.label)) continue
          seen.add(r.label)
          labels.push(r.label)
        }
        return { rows: labels.map((label) => ({ label })), rowsAffected: 0 }
      }
      if (/^SELECT label, content_hash FROM entity_embeddings/i.test(s)) {
        const type = String(params[0])
        return {
          rows: embeddingRows
            .filter((r) => r.type === type)
            .map((r) => ({ label: r.label, content_hash: r.content_hash })),
          rowsAffected: 0,
        }
      }
      if (/^INSERT INTO entity_embeddings/i.test(s)) {
        // label, type, dim, vector, content_hash, updated_at
        const [label, type, , , content_hash] = params
        embeddingRows = embeddingRows.filter(
          (r) => !(r.type === type && r.label === label)
        )
        embeddingRows.push({ type: String(type), label: String(label), content_hash: String(content_hash) })
        return { rows: [], rowsAffected: 1 }
      }
      return { rows: [], rowsAffected: 0 }
    },
  } as unknown as SqliteDatabase
})

const embedFn = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  // Per-label vectors: succeed for most labels, fail mid-pass on the one we
  // ask backfill to isolate via a Result failure.
  embedFn.mockImplementation((text: string) =>
    text === 'fails'
      ? Promise.resolve(err('EMBED_FAILED', 'mock embed failure'))
      : Promise.resolve(ok([Math.random(), 0.1, 0.2]))
  )
})

describe('storage/entity-embeddings backfill — F-02A.2 failure isolation', () => {
  it('continues after a per-label embed failure and reports {embedded, failed} counts only', async () => {
    entityRows = [
      { type: 'belief', label: 'first' },
      { type: 'belief', label: 'fails' }, // embedFn returns !success here
      { type: 'belief', label: 'last' },
    ]

    const result = await backfillEntityEmbeddings('belief', embedFn, fakeDb)

    // Old `break` semantics would stop at 'fails', leaving 'last' unembedded.
    expect(embedFn).toHaveBeenCalledTimes(3) // first, fails, last
    expect(result).toEqual({ embedded: 2, failed: 1 })
    // The caller never receives label text in the result — counts only.
    expect(JSON.stringify(result)).not.toContain('fails')
  })

  it('counts a thrown embed error as failed, not as a pass-stopping exception', async () => {
    embedFn.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    embedFn.mockResolvedValueOnce(ok([0.5, 0.5]))
    embedFn.mockResolvedValueOnce(ok([0.6, 0.4]))
    entityRows = [
      { type: 'belief', label: 'throws' },
      { type: 'belief', label: 'a' },
      { type: 'belief', label: 'b' },
    ]

    const result = await backfillEntityEmbeddings('belief', embedFn, fakeDb)

    expect(embedFn).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ embedded: 2, failed: 1 })
  })

  it('skips labels whose stored content hash already matches', async () => {
    // Store via the real upsert so the hash matches what backfill computes.
    const v = await upsertEntityEmbedding('cached', 'belief', [0.1], fakeDb)
    expect(v.success).toBe(true)
    entityRows = [
      { type: 'belief', label: 'cached' }, // hash matches → skipped
      { type: 'belief', label: 'fresh' }, // embedded
    ]

    const result = await backfillEntityEmbeddings('belief', embedFn, fakeDb)

    expect(embedFn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ embedded: 1, failed: 0 })
  })

  it('does not throw when the underlying query path rejects', async () => {
    fakeDb = {
      async execute() {
        throw new Error('db corruption')
      },
    } as unknown as SqliteDatabase

    const result = await backfillEntityEmbeddings('belief', embedFn, fakeDb)
    // Best-effort — never throws, counts reflect nothing processed.
    expect(result).toEqual({ embedded: 0, failed: 0 })
  })
})
